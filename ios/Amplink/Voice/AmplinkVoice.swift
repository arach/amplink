// AmplinkVoice — Voice capture and transcription for the Amplink composer.
//
// Two modes:
//   FluidAudio present  -> real Parakeet TDT inference (on-device, no network)
//   FluidAudio absent   -> AVAudioRecorder capture + mock transcription text
//
// Uses AVAudioRecorder (not AVAudioEngine) for reliable on-device recording.
// Records to a temp WAV file, then loads samples for transcription.
// Pattern taken from Talkie's battle-tested AudioRecorderManager.

import AVFoundation
import Speech
import os.log

private let log = AmplinkLog.voice

// MARK: - FluidAudio Engine (real transcription)

#if canImport(FluidAudio)
import FluidAudio

/// Manages Parakeet model download, load, warmup, and transcription.
@MainActor
final class ParakeetModelManager: ObservableObject {
    static let shared = ParakeetModelManager()

    @Published var state: AmplinkVoice.ModelState = .notDownloaded
    @Published var isWarmedUp = false

    private var asrManager: AsrManager?

    var isReady: Bool { state == .ready && isWarmedUp }

    private init() {
        let cached = AsrModels.modelsExist(at: AsrModels.defaultCacheDirectory(for: .v3))
        state = cached ? .downloaded : .notDownloaded
    }

    func downloadAndLoad() async throws {
        state = .downloading(progress: 0)
        log.info("Downloading Parakeet v3 model")

        let models: AsrModels
        let cacheDir = AsrModels.defaultCacheDirectory(for: .v3)

        if AsrModels.modelsExist(at: cacheDir) {
            state = .loading
            models = try await AsrModels.loadFromCache(version: .v3)
        } else {
            state = .downloading(progress: 0.5)
            models = try await AsrModels.downloadAndLoad(version: .v3)
        }

        state = .loading

        let manager = AsrManager(config: .default)
        try await manager.loadModels(models)
        self.asrManager = manager
        state = .ready
        isWarmedUp = false

        log.info("Parakeet v3 loaded, starting warmup")

        // Warmup on background thread
        let warmupManager = manager
        Task.detached(priority: .userInitiated) {
            let samples = (0..<32000).map { _ in Float.random(in: -0.0001...0.0001) }
            do {
                _ = try await warmupManager.transcribe(samples)
                log.info("Parakeet warmup complete")
            } catch {
                log.warning("Parakeet warmup skipped: \(error.localizedDescription)")
            }
            await MainActor.run { self.isWarmedUp = true }
        }
    }

    /// Transcribe from a file URL (Parakeet can do this directly, no sample loading needed).
    func transcribe(url: URL) async throws -> String {
        guard let manager = asrManager, state == .ready else {
            throw AmplinkVoice.VoiceError.notReady
        }
        let result = try await manager.transcribe(url, source: .microphone)
        return result.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func unload() {
        asrManager = nil
        isWarmedUp = false
        state = .downloaded
        log.info("Parakeet model unloaded")
    }
}
#endif

// MARK: - AmplinkVoice

/// Voice capture and transcription engine for the composer.
///
/// Uses AVAudioRecorder to capture audio to a temp PCM file. On stop,
/// the file is loaded and samples are extracted for transcription.
/// When FluidAudio is available, samples go through Parakeet for on-device
/// transcription. Otherwise a mock transcript is returned.
@MainActor
final class AmplinkVoice: NSObject, ObservableObject, AVAudioPlayerDelegate {

    // MARK: - Types

    enum ReplyAudioMode: String, CaseIterable, Identifiable {
        case both
        case acknowledgementOnly = "ack"
        case resultOnly = "result"
        case off

        var id: String { rawValue }

        var label: String {
            switch self {
            case .both: "Receipt + Completion"
            case .acknowledgementOnly: "Receipt Only"
            case .resultOnly: "Completion Only"
            case .off: "Off"
            }
        }
    }

    enum VoiceInputMode: String, CaseIterable, Identifiable {
        case review = "review"
        case immediate = "immediate"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .review: "Review in Composer"
            case .immediate: "Send Immediately"
            }
        }
    }

    enum ModelState: Equatable {
        case notDownloaded
        case downloading(progress: Double)
        case downloaded
        case loading
        case ready
        case error(String)
    }

    enum State: Sendable, Equatable {
        case idle
        case preparing
        case ready
        case recording
        case transcribing
        case error(String)
    }

    enum VoiceError: Error, LocalizedError {
        case notReady
        case notRecording
        case alreadyRecording
        case microphonePermissionDenied
        case audioSessionFailed(String)
        case recordingTooShort
        case recordingFailed(String)
        case dispatchFailed(String)

        var errorDescription: String? {
            switch self {
            case .notReady: "Voice engine not ready. Call prepare() first."
            case .notRecording: "No recording in progress."
            case .alreadyRecording: "A recording is already in progress."
            case .microphonePermissionDenied: "Microphone permission denied."
            case .audioSessionFailed(let d): "Audio session failed: \(d)"
            case .recordingTooShort: "Recording too short (minimum 0.3s)."
            case .recordingFailed(let d): "Recording failed: \(d)"
            case .dispatchFailed(let d): "Voice dispatch failed: \(d)"
            }
        }
    }

    // MARK: - Published State

    @Published private(set) var state: State = .idle
    @Published private(set) var audioLevels: [Float] = []
    @Published private(set) var recordingDuration: TimeInterval = 0
    @Published private(set) var lastVoiceReply: String?
    @Published private(set) var currentVoiceOverlay: VoiceOverlay?
    @Published private(set) var isPlayingVoiceReply = false

    // MARK: - Private

    private var audioRecorder: AVAudioRecorder?
    private var audioPlayer: AVAudioPlayer?
    private var activeVoiceSocket: URLSessionWebSocketTask?
    private var activeVoiceSessionId: String?
    private var activeVoiceListenerTask: Task<Void, Never>?
    private var recordingStartTime: Date?
    private var durationTimer: Timer?
    private var meteringTimer: Timer?
    private var recordingURL: URL?
    private let cloudflareSession = URLSession(configuration: .default)

    nonisolated static let replyAudioModeKey = "amplink.voiceReplyAudioMode"
    nonisolated static let voiceInputModeKey = "amplink.voiceInputMode"
    nonisolated static let cloudflareBaseURLSettingsKey = "amplink.cloudflareVoiceBaseURL"
    nonisolated static let cloudflareUserIdSettingsKey = "amplink.cloudflareVoiceUserID"
    nonisolated static let defaultCloudflareBaseURL = "https://amplink.arach.workers.dev"

    static var configuredCloudflareBaseURL: String {
        let stored = UserDefaults.standard.string(forKey: cloudflareBaseURLSettingsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let stored, !stored.isEmpty {
            return stored
        }
        return defaultCloudflareBaseURL
    }

    static var replyAudioMode: ReplyAudioMode {
        get {
            if let rawValue = UserDefaults.standard.string(forKey: replyAudioModeKey),
               let mode = ReplyAudioMode(rawValue: rawValue) {
                return mode
            }

            return .both
        }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: replyAudioModeKey)
        }
    }

    static var voiceInputMode: VoiceInputMode {
        get {
            if let rawValue = UserDefaults.standard.string(forKey: voiceInputModeKey),
               let mode = VoiceInputMode(rawValue: rawValue) {
                return mode
            }

            return .review
        }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: voiceInputModeKey)
        }
    }

    /// Recording is always available — transcription engine loads separately.
    var isReady: Bool { state == .ready }

    /// Temp directory for recording files.
    private var tempRecordingURL: URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("amplink_recording_\(UUID().uuidString).wav")
    }

    override init() {
        super.init()
    }

    // MARK: - Lifecycle

    /// Prepare the voice engine. Recording is available immediately.
    /// Parakeet loads in the background — Apple Speech is used until it's warm.
    func prepare() async {
        // Recording is ready immediately — we only need AVAudioRecorder + Apple Speech.
        // Parakeet model loading is kicked off at app launch (AmplinkApp.swift).
        state = .ready
        log.info("AmplinkVoice ready (recording + Apple Speech available)")
    }

    // MARK: - Permissions

    func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    // MARK: - Recording

    func startRecording() async throws {
        stopPlayback()

        // Clean up any stale recording from a previous attempt
        if audioRecorder != nil {
            log.warning("Cleaning up stale recorder before starting new recording")
            cancelRecording()
        }

        let granted = await requestMicrophonePermission()
        guard granted else { throw VoiceError.microphonePermissionDenied }

        // Configure audio session (Talkie pattern: check for external output)
        let session = AVAudioSession.sharedInstance()
        do {
            let hasExternalOutput = session.currentRoute.outputs.contains {
                $0.portType == .bluetoothA2DP || $0.portType == .bluetoothHFP
                    || $0.portType == .headphones || $0.portType == .bluetoothLE
            }
            let options: AVAudioSession.CategoryOptions = hasExternalOutput
                ? [.allowBluetoothA2DP, .allowBluetooth]
                : [.defaultToSpeaker, .allowBluetoothA2DP, .allowBluetooth]

            try session.setCategory(.playAndRecord, mode: .default, options: options)
            try session.setPreferredIOBufferDuration(0.005)
            try session.setActive(true)
            log.info("Audio session active (external output: \(hasExternalOutput))")
        } catch {
            throw VoiceError.audioSessionFailed(error.localizedDescription)
        }

        // Record as 16kHz mono PCM — ready for Parakeet without conversion
        let url = tempRecordingURL
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16000.0,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]

        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            recorder.prepareToRecord()

            guard recorder.record() else {
                throw VoiceError.recordingFailed("AVAudioRecorder.record() returned false")
            }

            self.audioRecorder = recorder
            self.recordingURL = url
            self.recordingStartTime = Date()
            self.recordingDuration = 0
            self.audioLevels = []
            state = .recording

            log.info("Recording started → \(url.lastPathComponent)")
        } catch let err as VoiceError {
            throw err
        } catch {
            throw VoiceError.recordingFailed(error.localizedDescription)
        }

        // Duration timer (0.1s tick)
        durationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, let start = self.recordingStartTime else { return }
                self.recordingDuration = Date().timeIntervalSince(start)
            }
        }

        // Metering timer (~15 Hz for waveform levels)
        meteringTimer = Timer.scheduledTimer(withTimeInterval: 0.066, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, let recorder = self.audioRecorder, recorder.isRecording else { return }
                recorder.updateMeters()

                // averagePower is in dB (-160..0). Normalize to 0..1.
                let db = recorder.averagePower(forChannel: 0)
                let minDb: Float = -50
                let normalized = max(0, (db - minDb) / -minDb)
                self.audioLevels.append(normalized)
                if self.audioLevels.count > 100 {
                    self.audioLevels.removeFirst(self.audioLevels.count - 100)
                }
            }
        }
    }

    /// Stop recording and transcribe the captured audio.
    /// Returns the transcribed text.
    func stopAndTranscribe() async throws -> String {
        guard let recorder = audioRecorder, let url = recordingURL else {
            throw VoiceError.notRecording
        }

        let duration = recordingDuration

        // Stop recorder
        recorder.stop()
        self.audioRecorder = nil

        stopTimers()

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        // Minimum recording length check
        if duration < 0.3 {
            state = .ready
            cleanupFile(url)
            throw VoiceError.recordingTooShort
        }

        state = .transcribing
        log.info("Transcribing \(url.lastPathComponent) (\(String(format: "%.1f", duration))s)")

        do {
            let text = try await transcribe(fileURL: url)
            state = .ready
            cleanupFile(url)
            return text
        } catch {
            state = .error(error.localizedDescription)
            cleanupFile(url)
            throw error
        }
    }

    /// Cancel an in-progress recording without transcribing.
    func cancelRecording() {
        audioRecorder?.stop()
        audioRecorder = nil

        stopTimers()

        if let url = recordingURL {
            cleanupFile(url)
        }
        recordingURL = nil
        audioLevels = []
        recordingDuration = 0
        recordingStartTime = nil

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        state = .ready
        log.info("Recording cancelled")
    }

    func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
        isPlayingVoiceReply = false

        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            log.warning("Could not deactivate voice playback session", detail: error.localizedDescription)
        }
    }

    // MARK: - Cloudflare Voice Dispatch

    func dispatchTranscriptToCloudflare(
        _ transcript: String,
        desktopSessionId: String,
        projectName: String? = nil,
        locale: String = Locale.current.identifier
    ) async throws -> CloudflareVoiceReply {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw VoiceError.dispatchFailed("Transcript was empty.")
        }

        stopPlayback()
        replaceActiveVoiceSession(with: nil, sessionId: nil)

        let startResponse = try await startCloudflareSession(
            desktopSessionId: desktopSessionId,
            projectName: projectName
        )

        guard let websocketURL = URL(string: startResponse.websocketUrl) else {
            throw VoiceError.dispatchFailed("Worker returned an invalid WebSocket URL.")
        }

        let socket = cloudflareSession.webSocketTask(with: websocketURL)
        socket.resume()

        do {
            try await waitForSessionReady(on: socket)

            let requestId = UUID().uuidString
            let payload = CloudflareVoiceInput(
                type: "voice.input",
                requestId: requestId,
                transcript: trimmed,
                locale: locale,
                metadata: [
                    "source": "ios-voice",
                    "desktopSessionId": desktopSessionId,
                    "projectName": projectName ?? "",
                    "ttsMode": currentReplyAudioMode().rawValue
                ]
            )

            let body = try encodeJSON(payload)
            try await socket.send(.string(body))
            log.info("Sent transcript to Cloudflare voice", detail: trimmed)

            let reply = try await waitForVoiceReply(
                on: socket,
                requestId: requestId
            )

            let overlay = VoiceOverlay(
                kind: .acknowledgement,
                presentation: reply.presentation ?? "overlay",
                writtenText: reply.writtenText ?? reply.text,
                spokenText: reply.spokenText ?? reply.text,
                sessionId: reply.sessionId,
                taskId: nil,
                status: "done",
                at: nil
            )
            applyVoiceOverlay(overlay)
            try playVoiceAudioIfPresent(reply.tts, kind: .acknowledgement)
            replaceActiveVoiceSession(with: socket, sessionId: startResponse.session.id)

            log.info(
                "Received Cloudflare voice reply",
                detail: "intent=\(reply.intent.intent) route=\(reply.trace?.dispatchRoute ?? "unknown") path=\(reply.trace?.path ?? "unknown")"
            )

            return reply
        } catch {
            socket.cancel(with: .normalClosure, reason: nil)
            throw error
        }
    }

    // MARK: - Sample Loading

    /// Load PCM samples from the recorded WAV file as [Float] at 16kHz mono.
    private func loadSamples(from url: URL) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat

        // If file is already 16kHz mono Float32, read directly
        if let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(file.length)
        ) {
            try file.read(into: buffer)

            // Convert Int16 PCM buffer to Float samples
            if let floatData = buffer.floatChannelData {
                return Array(UnsafeBufferPointer(start: floatData[0], count: Int(buffer.frameLength)))
            }

            // If the buffer has int16 data, convert manually
            if let int16Data = buffer.int16ChannelData {
                let count = Int(buffer.frameLength)
                return (0..<count).map { Float(int16Data[0][$0]) / 32768.0 }
            }
        }

        throw VoiceError.recordingFailed("Could not read audio samples from file")
    }

    // MARK: - Helpers

    private func stopTimers() {
        durationTimer?.invalidate()
        durationTimer = nil
        meteringTimer?.invalidate()
        meteringTimer = nil
    }

    private func cleanupFile(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: - Transcription

    /// Which engine was used for the last transcription (for debug display).
    @Published private(set) var lastEngine: String = "none"

    private func transcribe(fileURL url: URL) async throws -> String {
        #if canImport(FluidAudio)
        // Prefer Parakeet if model is loaded and warm
        if ParakeetModelManager.shared.isReady {
            log.info("Transcribing with Parakeet (on-device AI)")
            lastEngine = "Parakeet"
            return try await ParakeetModelManager.shared.transcribe(url: url)
        }
        #endif

        // Fallback: Apple Speech (on-device, no download, available immediately)
        log.info("Transcribing with Apple Speech (on-device)")
        lastEngine = "Apple Speech"
        return try await transcribeWithAppleSpeech(url: url)
    }

    private func startCloudflareSession(
        desktopSessionId: String,
        projectName: String?
    ) async throws -> CloudflareStartSessionResponse {
        let baseURL = cloudflareBaseURL()
        let url = baseURL.appending(path: "start-session")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(cloudflareUserId(), forHTTPHeaderField: "X-Amplink-User")

        let body = CloudflareStartSessionRequest(
            title: projectName.map { "Voice — \($0)" } ?? "Amplink Voice",
            metadata: [
                "source": "ios-voice",
                "desktopSessionId": desktopSessionId,
                "projectName": projectName ?? "",
                "ttsMode": currentReplyAudioMode().rawValue
            ]
        )
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await cloudflareSession.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw VoiceError.dispatchFailed("Cloudflare start-session returned an invalid response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let detail = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw VoiceError.dispatchFailed(detail)
        }

        return try JSONDecoder().decode(CloudflareStartSessionResponse.self, from: data)
    }

    private func waitForSessionReady(
        on socket: URLSessionWebSocketTask
    ) async throws {
        while true {
            let text = try await receiveTextMessage(from: socket)
            let envelope = try JSONDecoder().decode(CloudflareSocketEnvelope.self, from: Data(text.utf8))
            switch envelope.type {
            case "session.ready":
                return
            case "voice.error":
                let error = try JSONDecoder().decode(CloudflareVoiceError.self, from: Data(text.utf8))
                throw VoiceError.dispatchFailed(error.message)
            default:
                continue
            }
        }
    }

    private func waitForVoiceReply(
        on socket: URLSessionWebSocketTask,
        requestId: String
    ) async throws -> CloudflareVoiceReply {
        while true {
            let text = try await receiveTextMessage(from: socket)
            let data = Data(text.utf8)
            let envelope = try JSONDecoder().decode(CloudflareSocketEnvelope.self, from: data)

            switch envelope.type {
            case "voice.reply":
                let reply = try JSONDecoder().decode(CloudflareVoiceReply.self, from: data)
                if reply.requestId == requestId {
                    return reply
                }
            case "voice.error":
                let error = try JSONDecoder().decode(CloudflareVoiceError.self, from: data)
                if error.requestId == nil || error.requestId == requestId {
                    throw VoiceError.dispatchFailed(error.message)
                }
            default:
                continue
            }
        }
    }

    private func receiveTextMessage(
        from socket: URLSessionWebSocketTask
    ) async throws -> String {
        switch try await socket.receive() {
        case .string(let value):
            return value
        case .data(let data):
            guard let value = String(data: data, encoding: .utf8) else {
                throw VoiceError.dispatchFailed("Worker returned non-text WebSocket data.")
            }
            return value
        @unknown default:
            throw VoiceError.dispatchFailed("Worker returned an unsupported WebSocket message.")
        }
    }

    private func playVoiceAudioIfPresent(
        _ tts: CloudflareVoiceTTS?,
        kind: VoiceOverlay.Kind
    ) throws {
        guard shouldPlayVoiceAudio(for: kind) else {
            log.info("Skipping voice overlay audio due to reply audio mode", detail: currentReplyAudioMode().rawValue)
            return
        }

        guard let tts else {
            log.warning("Cloudflare voice payload did not include TTS audio")
            return
        }

        guard let audioData = Data(base64Encoded: tts.audioBase64) else {
            throw VoiceError.dispatchFailed("Cloudflare voice audio payload was invalid.")
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)

            audioPlayer?.stop()
            let player = try AVAudioPlayer(data: audioData)
            player.delegate = self
            player.prepareToPlay()

            guard player.play() else {
                throw VoiceError.dispatchFailed("Audio playback did not start.")
            }

            audioPlayer = player
            isPlayingVoiceReply = true
            log.info("Playing Cloudflare voice overlay audio")
        } catch let error as VoiceError {
            throw error
        } catch {
            throw VoiceError.dispatchFailed(error.localizedDescription)
        }
    }

    private func replaceActiveVoiceSession(
        with socket: URLSessionWebSocketTask?,
        sessionId: String?
    ) {
        activeVoiceListenerTask?.cancel()
        activeVoiceListenerTask = nil

        if let existingSocket = activeVoiceSocket {
            existingSocket.cancel(with: .goingAway, reason: nil)
        }

        activeVoiceSocket = socket
        activeVoiceSessionId = sessionId

        guard let socket, let sessionId else {
            return
        }

        activeVoiceListenerTask = Task { [weak self] in
            await self?.listenForVoiceUpdates(on: socket, sessionId: sessionId)
        }
    }

    private func clearActiveVoiceSession(sessionId: String) {
        if activeVoiceSessionId == sessionId {
            activeVoiceListenerTask = nil
            activeVoiceSocket = nil
            activeVoiceSessionId = nil
        }
    }

    private func listenForVoiceUpdates(
        on socket: URLSessionWebSocketTask,
        sessionId: String
    ) async {
        while !Task.isCancelled {
            do {
                let text = try await receiveTextMessage(from: socket)
                let data = Data(text.utf8)
                let envelope = try JSONDecoder().decode(CloudflareSocketEnvelope.self, from: data)

                switch envelope.type {
                case "voice.result":
                    let result = try JSONDecoder().decode(CloudflareVoiceResult.self, from: data)
                    let overlay = VoiceOverlay(
                        kind: .backgroundResult,
                        presentation: result.presentation,
                        writtenText: result.writtenText,
                        spokenText: result.spokenText,
                        sessionId: result.sessionId,
                        taskId: result.taskId,
                        status: result.status,
                        at: result.at
                    )
                    applyVoiceOverlay(overlay)
                    try playVoiceAudioIfPresent(result.tts, kind: .backgroundResult)
                    socket.cancel(with: .normalClosure, reason: nil)
                    clearActiveVoiceSession(sessionId: sessionId)
                    return
                case "voice.error":
                    let error = try JSONDecoder().decode(CloudflareVoiceError.self, from: data)
                    log.warning("Cloudflare voice session error", detail: error.message)
                default:
                    continue
                }
            } catch {
                if Task.isCancelled {
                    break
                }

                log.warning("Cloudflare voice listener stopped", detail: error.localizedDescription)
                break
            }
        }

        clearActiveVoiceSession(sessionId: sessionId)
    }

    private func applyVoiceOverlay(_ overlay: VoiceOverlay) {
        currentVoiceOverlay = overlay
        lastVoiceReply = overlay.writtenText
    }

    private func currentReplyAudioMode() -> ReplyAudioMode {
        Self.replyAudioMode
    }

    private func shouldPlayVoiceAudio(for kind: VoiceOverlay.Kind) -> Bool {
        switch currentReplyAudioMode() {
        case .both:
            true
        case .acknowledgementOnly:
            kind == .acknowledgement
        case .resultOnly:
            kind == .backgroundResult
        case .off:
            false
        }
    }

    private func cloudflareBaseURL() -> URL {
        let stored = UserDefaults.standard.string(forKey: Self.cloudflareBaseURLSettingsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let raw = stored.flatMap { value in
            value.isEmpty ? nil : value
        } ?? Self.defaultCloudflareBaseURL
        return URL(string: raw) ?? URL(string: Self.defaultCloudflareBaseURL)!
    }

    private func cloudflareUserId() -> String {
        if let existing = UserDefaults.standard.string(forKey: Self.cloudflareUserIdSettingsKey),
           !existing.isEmpty {
            return existing
        }

        let generated = "ios-\(UUID().uuidString.lowercased())"
        UserDefaults.standard.set(generated, forKey: Self.cloudflareUserIdSettingsKey)
        return generated
    }

    private func encodeJSON<T: Encodable>(_ value: T) throws -> String {
        let data = try JSONEncoder().encode(value)
        guard let text = String(data: data, encoding: .utf8) else {
            throw VoiceError.dispatchFailed("Failed to encode the voice payload.")
        }
        return text
    }

    /// On-device transcription using SFSpeechRecognizer. No network needed.
    private func transcribeWithAppleSpeech(url: URL) async throws -> String {
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
            throw VoiceError.recordingFailed("Speech recognizer not available")
        }

        // Request speech recognition permission if needed
        let authStatus = SFSpeechRecognizer.authorizationStatus()
        if authStatus == .notDetermined {
            let granted = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status == .authorized)
                }
            }
            guard granted else {
                throw VoiceError.recordingFailed("Speech recognition permission denied")
            }
        } else if authStatus != .authorized {
            throw VoiceError.recordingFailed("Speech recognition not authorized")
        }

        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false

        // recognitionTask calls its callback multiple times (partial results,
        // final result, then sometimes a cancellation error). Resuming a checked
        // continuation twice crashes. Guard with hasResumed.
        return try await withCheckedThrowingContinuation { continuation in
            var hasResumed = false
            recognizer.recognitionTask(with: request) { result, error in
                guard !hasResumed else { return }

                if let error {
                    hasResumed = true
                    continuation.resume(throwing: VoiceError.recordingFailed(
                        "Speech recognition failed: \(error.localizedDescription)"
                    ))
                    return
                }
                guard let result, result.isFinal else { return }
                hasResumed = true
                let text = result.bestTranscription.formattedString
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty {
                    continuation.resume(throwing: VoiceError.recordingFailed("No speech detected"))
                } else {
                    continuation.resume(returning: text)
                }
            }
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isPlayingVoiceReply = false
            self.audioPlayer = nil
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            self.isPlayingVoiceReply = false
            self.audioPlayer = nil
            if let error {
                log.warning("Voice audio decode error", detail: error.localizedDescription)
            }
        }
    }
}

private struct CloudflareStartSessionRequest: Encodable {
    let title: String
    let metadata: [String: String]
}

private struct CloudflareStartSessionResponse: Decodable {
    let session: CloudflareVoiceSession
    let websocketUrl: String
}

private struct CloudflareVoiceSession: Decodable {
    let id: String
}

private struct CloudflareSocketEnvelope: Decodable {
    let type: String
}

private struct CloudflareVoiceInput: Encodable {
    let type: String
    let requestId: String
    let transcript: String
    let locale: String
    let metadata: [String: String]
}

private struct CloudflareVoiceError: Decodable {
    let type: String
    let requestId: String?
    let message: String
}

struct VoiceOverlay: Equatable {
    enum Kind: String, Equatable {
        case acknowledgement
        case backgroundResult
    }

    let kind: Kind
    let presentation: String
    let writtenText: String
    let spokenText: String
    let sessionId: String
    let taskId: String?
    let status: String
    let at: String?
}

struct CloudflareVoiceTTS: Decodable {
    let provider: String
    let voiceId: String
    let modelId: String
    let contentType: String
    let audioBase64: String
}

struct CloudflareVoiceReply: Decodable {
    struct Intent: Decodable {
        let intent: String
        let shouldDispatch: Bool
        let confidence: Double
    }

    struct Trace: Decodable {
        let path: String
        let dispatchAttempted: Bool
        let dispatchQueued: Bool
        let dispatchRoute: String
        let dispatchTaskId: String?
        let dispatchError: String?
    }

    let type: String
    let requestId: String
    let sessionId: String
    let text: String
    let spokenText: String?
    let writtenText: String?
    let presentation: String?
    let intent: Intent
    let tts: CloudflareVoiceTTS?
    let trace: Trace?
}

struct CloudflareVoiceResult: Decodable {
    let type: String
    let sessionId: String
    let taskId: String
    let status: String
    let presentation: String
    let spokenText: String
    let writtenText: String
    let tts: CloudflareVoiceTTS?
    let at: String?
}

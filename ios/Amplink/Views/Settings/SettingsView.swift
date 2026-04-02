// SettingsView — Debug, voice engine, and connection settings.

import SwiftUI

struct SettingsView: View {
    @Environment(ConnectionManager.self) private var connection
    @StateObject private var voice = AmplinkVoice()
    @AppStorage(AmplinkVoice.replyAudioModeKey)
    private var replyAudioModeRawValue = AmplinkVoice.ReplyAudioMode.both.rawValue
    @AppStorage(AmplinkVoice.voiceInputModeKey)
    private var voiceInputModeRawValue = AmplinkVoice.VoiceInputMode.review.rawValue
    @AppStorage(AmplinkVoice.cloudflareBaseURLSettingsKey)
    private var cloudflareBaseURL = AmplinkVoice.defaultCloudflareBaseURL

    var body: some View {
        NavigationStack {
            List {
                voiceSection
                connectionSection
                debugSection
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    // MARK: - Voice

    private var voiceSection: some View {
        Section {
            HStack {
                Label("Engine", systemImage: "waveform")
                Spacer()
                Text(engineName)
                    .foregroundStyle(AmplinkColors.textSecondary)
            }

            HStack {
                Label("State", systemImage: "circle.fill")
                Spacer()
                Text(voiceStateName)
                    .foregroundStyle(voiceStateColor)
            }

            #if canImport(FluidAudio)
            HStack {
                Label("Parakeet Model", systemImage: "cpu")
                Spacer()
                Text(parakeetStatus)
                    .foregroundStyle(AmplinkColors.textSecondary)
            }
            #endif

            HStack {
                Label("Last Used", systemImage: "clock")
                Spacer()
                Text(voice.lastEngine)
                    .foregroundStyle(AmplinkColors.textSecondary)
            }

            Picker("Voice Input", selection: $voiceInputModeRawValue) {
                ForEach(AmplinkVoice.VoiceInputMode.allCases) { mode in
                    Text(mode.label).tag(mode.rawValue)
                }
            }

            Picker("Spoken Replies", selection: $replyAudioModeRawValue) {
                ForEach(AmplinkVoice.ReplyAudioMode.allCases) { mode in
                    Text(mode.label).tag(mode.rawValue)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Label("Cloudflare Voice Backend", systemImage: "cloud")
                TextField("https://your-worker.your-subdomain.workers.dev", text: $cloudflareBaseURL)
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                    .font(AmplinkTypography.caption(14))
            }
        } header: {
            Text("Voice")
        } footer: {
            #if canImport(FluidAudio)
            Text("Parakeet provides on-device AI transcription. Apple Speech is used as a fallback while the model loads (~90s). Review in Composer keeps dictation in the text field until you tap Send. Send Immediately dispatches the transcript to Amplink as soon as recording ends. Spoken reply changes apply immediately to the next voice turn, and overlay text still appears when audio is off. Change the Cloudflare backend URL here if you deploy Amplink into your own account.")
            #else
            Text("Using Apple Speech for on-device transcription. Add FluidAudio for Parakeet AI transcription. Review in Composer keeps dictation in the text field until you tap Send. Send Immediately dispatches the transcript to Amplink as soon as recording ends. Spoken reply changes apply immediately to the next voice turn, and overlay text still appears when audio is off. Change the Cloudflare backend URL here if you deploy Amplink into your own account.")
            #endif
        }
    }

    // MARK: - Connection

    private var connectionSection: some View {
        Section {
            HStack {
                Label("Status", systemImage: "antenna.radiowaves.left.and.right")
                Spacer()
                HStack(spacing: 6) {
                    Circle()
                        .fill(connectionColor)
                        .frame(width: 8, height: 8)
                    Text(connectionLabel)
                        .foregroundStyle(AmplinkColors.textSecondary)
                }
            }

            if connection.hasTrustedBridge {
                HStack {
                    Label("Trusted Bridge", systemImage: "checkmark.shield")
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(AmplinkColors.statusActive)
                }

                if let relayURL = connection.bridgeRelayURL {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Desktop Relay", systemImage: "point.3.connected.trianglepath.dotted")
                        Text(relayURL)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(AmplinkColors.textSecondary)
                            .textSelection(.enabled)
                    }
                }

                if let roomID = connection.bridgeRoomID {
                    HStack {
                        Label("Desktop Room", systemImage: "number")
                        Spacer()
                        Text(roomID)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(AmplinkColors.textSecondary)
                            .textSelection(.enabled)
                    }
                }

                Button(role: .destructive) {
                    connection.clearTrustedBridge()
                } label: {
                    Label("Forget Bridge", systemImage: "trash")
                }
            }
        } header: {
            Text("Connection")
        }
    }

    // MARK: - Debug

    private var debugSection: some View {
        Section {
            NavigationLink {
                LogView()
            } label: {
                HStack {
                    Label("Logs", systemImage: "doc.text")
                    Spacer()
                    if logStore.errorCount > 0 {
                        Text("\(logStore.errorCount) errors")
                            .font(AmplinkTypography.caption(12))
                            .foregroundStyle(AmplinkColors.statusError)
                    } else {
                        Text("\(logStore.entries.count) entries")
                            .font(AmplinkTypography.caption(12))
                            .foregroundStyle(AmplinkColors.textMuted)
                    }
                }
            }

            HStack {
                Label("Build", systemImage: "hammer")
                Spacer()
                Text(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
                    .foregroundStyle(AmplinkColors.textSecondary)
            }

            HStack {
                Label("Device", systemImage: "iphone")
                Spacer()
                Text(UIDevice.current.name)
                    .foregroundStyle(AmplinkColors.textSecondary)
            }

            HStack {
                Label("iOS", systemImage: "gear")
                Spacer()
                Text(UIDevice.current.systemVersion)
                    .foregroundStyle(AmplinkColors.textSecondary)
            }

            Button {
                UserDefaults.standard.set(false, forKey: "hasCompletedOnboarding")
            } label: {
                Label("Reset Onboarding", systemImage: "arrow.counterclockwise")
            }
        } header: {
            Text("Debug")
        }
    }

    @ObservedObject private var logStore = LogStore.shared

    // MARK: - Computed

    private var engineName: String {
        #if canImport(FluidAudio)
        "Parakeet + Apple Speech"
        #else
        "Apple Speech (on-device)"
        #endif
    }

    private var voiceStateName: String {
        switch voice.state {
        case .idle: "Idle"
        case .preparing: "Preparing..."
        case .ready: "Ready"
        case .recording: "Recording"
        case .transcribing: "Transcribing"
        case .error(let e): "Error: \(e)"
        }
    }

    private var voiceStateColor: Color {
        switch voice.state {
        case .ready: AmplinkColors.statusActive
        case .recording: AmplinkColors.statusError
        case .transcribing: AmplinkColors.statusStreaming
        case .error: AmplinkColors.statusError
        default: AmplinkColors.textSecondary
        }
    }

    #if canImport(FluidAudio)
    private var parakeetStatus: String {
        switch ParakeetModelManager.shared.state {
        case .notDownloaded: "Not downloaded"
        case .downloading(let p): "Downloading \(Int(p * 100))%"
        case .downloaded: "Downloaded"
        case .loading: "Loading..."
        case .ready:
            ParakeetModelManager.shared.isWarmedUp ? "Ready" : "Warming up..."
        case .error(let e): "Error: \(e)"
        }
    }
    #endif

    private var connectionColor: Color {
        switch connection.state {
        case .connected: AmplinkColors.statusActive
        case .connecting, .handshaking, .reconnecting: AmplinkColors.statusStreaming
        case .disconnected: AmplinkColors.statusIdle
        case .failed: AmplinkColors.statusError
        }
    }

    private var connectionLabel: String {
        switch connection.state {
        case .connected: "Connected"
        case .connecting: "Connecting"
        case .handshaking: "Handshaking"
        case .reconnecting: "Reconnecting"
        case .disconnected: "Disconnected"
        case .failed: "Failed"
        }
    }
}

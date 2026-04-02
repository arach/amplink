// ComposerView — Voice-first input with tap-on/tap-off mic.
//
// Tray: [discovery] — [mic] — [keyboard]
// Mic toggles recording. After transcription, the utterance either lands in the
// composer for review or is sent to the Cloudflare voice worker immediately,
// depending on the selected voice input mode. Keyboard only when explicitly toggled.

import SwiftUI

struct ComposerView: View {
    @Environment(SessionStore.self) private var store

    let sessionId: String
    var projectName: String? = nil
    let isConnected: Bool
    let isStreaming: Bool
    var model: String?
    var turnCount: Int = 0
    var branch: String?
    let onSend: (String) -> Void
    let onInterrupt: () -> Void

    @State private var text = ""
    @State private var showKeyboard = false
    @State private var showDiscovery = false

    @StateObject private var voice = AmplinkVoice()
    @AppStorage(AmplinkVoice.voiceInputModeKey)
    private var voiceInputModeRawValue = AmplinkVoice.VoiceInputMode.review.rawValue

    @State private var micState: MicButtonState = .idle
    @State private var isVoiceDispatching = false
    @State private var lastError: String?
    @State private var justSent = false

    private var isRecording: Bool { micState == .recording }
    private var isTranscribing: Bool { micState == .transcribing }
    private var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var canSend: Bool { isConnected && hasText && !isStreaming && !isVoiceDispatching }
    private var showMessageField: Bool { hasText || showKeyboard }
    private var voiceInputMode: AmplinkVoice.VoiceInputMode {
        AmplinkVoice.VoiceInputMode(rawValue: voiceInputModeRawValue) ?? .review
    }

    // Keyboard button center = 14 (horizontal pad) + 24 (half of 48pt button) = 38pt from trailing edge
    private let sendButtonTrailing: CGFloat = 14 + 24 - 16 // 38 - half send button width

    var body: some View {
        VStack(spacing: 0) {
            if let lastError {
                Text(lastError)
                    .font(AmplinkTypography.caption(12, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
                    .background(AmplinkColors.statusError.opacity(0.85))
                    .onTapGesture { self.lastError = nil }
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(for: .seconds(4))
                        withAnimation { self.lastError = nil }
                    }
            }

            // Message field — always visible
            messageField

            // Keyboard (only when explicitly toggled)
            if showKeyboard && !isRecording && !isTranscribing {
                AmplinkKeyboardView(
                    text: $text,
                    dictationState: .idle,
                    onInsert: { char in text.append(char) },
                    onDelete: { if !text.isEmpty { text.removeLast() } },
                    onReturn: { text.append("\n") },
                    onVoice: { handleMicTap() },
                    onDismiss: { withAnimation { showKeyboard = false } }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            // Session metadata
            sessionMeta

            if let voiceOverlay {
                voiceOverlayView(voiceOverlay)
            }

            // Action Tray
            actionTray
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: showMessageField)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: showKeyboard)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: micState)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $showDiscovery) {
            SessionDiscoveryView(projectFilter: projectName)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .task {
            await voice.prepare()
        }
    }

    // MARK: - Action Tray

    private var actionTray: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                leftButton.frame(width: 48, height: 48)
                Spacer()
                centerButton
                Spacer()
                rightButton.frame(width: 48, height: 48)
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, -18)
        }
        .frame(maxWidth: .infinity)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [.white.opacity(0.12), .white.opacity(0.04), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(height: 1)
        }
        .background {
            Color.clear
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 0))
                .ignoresSafeArea(edges: .bottom)
        }
    }

    // MARK: - Buttons

    private var leftButton: some View {
        BottomCircleButton(icon: "sparkle.magnifyingglass", isActive: showDiscovery) {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            showDiscovery = true
        }
        .accessibilityLabel("Browse sessions")
    }

    @ViewBuilder
    private var centerButton: some View {
        if isStreaming {
            Button {
                onInterrupt()
            } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(AmplinkColors.statusError)
                    .frame(width: 70, height: 70)
                    .background(AmplinkColors.statusError.opacity(0.12))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .transition(.scale.combined(with: .opacity))
        } else if isVoiceDispatching {
            sendingVoiceButton
        } else if voice.isPlayingVoiceReply {
            Button {
                voice.stopPlayback()
            } label: {
                Image(systemName: "speaker.slash.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(AmplinkColors.statusStreaming)
                    .frame(width: 70, height: 70)
                    .background(AmplinkColors.statusStreaming.opacity(0.12))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .transition(.scale.combined(with: .opacity))
        } else {
            MicButton(
                state: currentMicState,
                onTap: handleMicTap,
                onLongPressStart: nil,
                onLongPressEnd: nil
            )
        }
    }

    private var sendingVoiceButton: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(AmplinkColors.statusStreaming.opacity(0.12))
                    .frame(width: 70, height: 70)

                ProgressView()
                    .controlSize(.regular)
                    .tint(AmplinkColors.statusStreaming)

                Image(systemName: "paperplane.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AmplinkColors.statusStreaming)
                    .offset(x: 13, y: -13)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Sending voice message")
        .accessibilityHint("Waiting for Amplink to accept the transcribed message")
        .transition(.scale.combined(with: .opacity))
    }

    private var rightButton: some View {
        BottomCircleButton(
            icon: showKeyboard ? "keyboard.chevron.compact.down" : "keyboard",
            isActive: showKeyboard
        ) {
            withAnimation { showKeyboard.toggle() }
        }
        .accessibilityLabel(showKeyboard ? "Hide keyboard" : "Show keyboard")
    }

    // MARK: - Message Field (stacked card above action tray)

    // Max height matches the action tray (~100pt)
    private let messageMaxHeight: CGFloat = 100

    private var messageField: some View {
        HStack(alignment: .top, spacing: 0) {
            AmplinkTextField(text: $text, placeholder: "Ask anything...", maxHeight: messageMaxHeight - 16)
                .frame(minHeight: 44, maxHeight: messageMaxHeight - 16, alignment: .top)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 16)
                .padding(.trailing, 8)

            Button {
                sendIfPossible()
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(canSend ? AmplinkColors.textPrimary : AmplinkColors.textSecondary)
                    .frame(width: 44, height: 44)
                    .background {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(.clear)
                            .glassEffect(.regular.interactive())
                    }
                    .scaleEffect(justSent ? 0.85 : 1.0)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .padding(.trailing, 14)
            .accessibilityLabel("Send message")
        }
        .padding(.top, 16)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity)
        .background(
            UnevenRoundedRectangle(
                topLeadingRadius: 16,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: 16,
                style: .continuous
            )
            .fill(AmplinkColors.surfaceAdaptive)
            .overlay(alignment: .top) {
                UnevenRoundedRectangle(
                    topLeadingRadius: 16,
                    bottomLeadingRadius: 0,
                    bottomTrailingRadius: 0,
                    topTrailingRadius: 16,
                    style: .continuous
                )
                .strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(0.15), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 0.5
                )
            }
            .shadow(color: .black.opacity(0.08), radius: 3, y: -1)
        )
        .animation(.easeInOut(duration: 0.15), value: canSend)
        .animation(.spring(response: 0.2, dampingFraction: 0.5), value: justSent)
    }

    // MARK: - Session Metadata

    private var shortModel: String? {
        guard let m = model else { return nil }
        // "claude-sonnet-4-20250514" → "sonnet 4"
        // "gpt-4o" → "gpt-4o"
        if m.contains("opus") { return "opus" }
        if m.contains("sonnet") { return "sonnet" }
        if m.contains("haiku") { return "haiku" }
        return m.components(separatedBy: "-").prefix(3).joined(separator: "-")
    }

    private var sessionMeta: some View {
        HStack(spacing: 12) {
            if let shortModel {
                metaChip(icon: "cpu", text: shortModel)
            }

            if turnCount > 0 {
                metaChip(icon: "arrow.turn.right.down", text: "\(turnCount)")
            }

            if let branch {
                metaChip(icon: "arrow.triangle.branch", text: branch)
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(AmplinkColors.backgroundAdaptive.opacity(0.5))
    }

    private func metaChip(icon: String, text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(AmplinkColors.textMuted)
            Text(text)
                .font(AmplinkTypography.caption(11, weight: .medium))
                .foregroundStyle(AmplinkColors.textMuted)
        }
    }

    private var voiceOverlay: VoiceOverlay? {
        voice.currentVoiceOverlay
    }

    @ViewBuilder
    private func voiceOverlayView(_ overlay: VoiceOverlay) -> some View {
        HStack(spacing: 10) {
            Image(systemName: overlay.kind == .backgroundResult ? "waveform.badge.checkmark" : "speaker.wave.2.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(overlay.kind == .backgroundResult ? AmplinkColors.statusActive : AmplinkColors.statusStreaming)

            VStack(alignment: .leading, spacing: 2) {
                Text(overlay.kind == .backgroundResult ? "Background Summary" : "Voice Summary")
                    .font(AmplinkTypography.caption(11, weight: .semibold))
                    .foregroundStyle(AmplinkColors.textMuted)
                Text(overlay.writtenText)
                    .font(AmplinkTypography.caption(13, weight: .medium))
                    .foregroundStyle(AmplinkColors.textPrimary)
                    .lineLimit(2)
            }

            Spacer(minLength: 8)

            if voice.isPlayingVoiceReply {
                Button {
                    voice.stopPlayback()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(AmplinkColors.textPrimary)
                        .frame(width: 28, height: 28)
                        .background(
                            Circle()
                                .fill(AmplinkColors.surfaceAdaptive.opacity(0.9))
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Stop voice playback")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(AmplinkColors.surfaceAdaptive.opacity(0.86))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(AmplinkColors.textMuted.opacity(0.12), lineWidth: 0.5)
        )
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - State

    private var currentMicState: MicButtonState {
        if isRecording { return .recording }
        if isTranscribing { return .transcribing }
        if !isConnected { return .disabled }
        return .idle
    }

    // MARK: - Actions

    private func sendIfPossible() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, isConnected, !isStreaming else { return }
        voice.stopPlayback()
        let impact = UIImpactFeedbackGenerator(style: .light)
        impact.impactOccurred()
        onSend(trimmed)
        text = ""
        showKeyboard = false

        // Brief scale-bounce on the send button
        justSent = true
        Task {
            try? await Task.sleep(for: .milliseconds(150))
            justSent = false
        }
    }

    private func handleMicTap() {
        guard !isVoiceDispatching else { return }
        switch micState {
        case .idle: startRecording()
        case .recording: stopRecording()
        case .transcribing, .disabled: break
        }
    }

    private func startRecording() {
        micState = .recording
        showKeyboard = false
        lastError = nil

        Task {
            do {
                if !voice.isReady { await voice.prepare() }
                let granted = await voice.requestMicrophonePermission()
                guard granted else {
                    lastError = "Mic permission denied"
                    micState = .idle
                    return
                }
                try await voice.startRecording()
            } catch {
                lastError = "Recording failed: \(error.localizedDescription)"
                micState = .idle
            }
        }
    }

    private func stopRecording() {
        micState = .transcribing

        Task {
            var transcribed: String?
            var optimisticTurnId: String?
            do {
                let value = try await voice.stopAndTranscribe()
                transcribed = value
                micState = .idle

                switch voiceInputMode {
                case .review:
                    mergeTranscriptIntoComposer(value)
                    lastError = nil

                case .immediate:
                    isVoiceDispatching = true
                    optimisticTurnId = store.appendLocalUserTurn(text: value, sessionId: sessionId)
                    _ = try await voice.dispatchTranscriptToCloudflare(
                        value,
                        desktopSessionId: sessionId,
                        projectName: projectName
                    )
                    isVoiceDispatching = false
                    text = ""
                    lastError = nil
                }
            } catch AmplinkVoice.VoiceError.recordingTooShort {
                isVoiceDispatching = false
                lastError = "Recording too short (min 0.3s)"
                micState = .idle
            } catch AmplinkVoice.VoiceError.dispatchFailed(let detail) {
                isVoiceDispatching = false
                if let optimisticTurnId {
                    store.removeLocalTurn(turnId: optimisticTurnId, sessionId: sessionId)
                }
                if let transcribed {
                    mergeTranscriptIntoComposer(transcribed)
                }
                lastError = "Voice dispatch failed. Transcript kept in composer."
                AmplinkLog.voice.error("Voice dispatch failed", detail: detail)
                micState = .idle
            } catch {
                isVoiceDispatching = false
                if let optimisticTurnId {
                    store.removeLocalTurn(turnId: optimisticTurnId, sessionId: sessionId)
                }
                if let transcribed {
                    mergeTranscriptIntoComposer(transcribed)
                }
                lastError = "Transcription: \(error.localizedDescription)"
                micState = .idle
            }
        }
    }

    private func mergeTranscriptIntoComposer(_ transcript: String) {
        let trimmedTranscript = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTranscript.isEmpty else { return }

        let trimmedExisting = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedExisting.isEmpty {
            text = trimmedTranscript
        } else if text.hasSuffix("\n") || text.hasSuffix(" ") {
            text += trimmedTranscript
        } else {
            text += "\n\(trimmedTranscript)"
        }

        showKeyboard = true
    }
}

// MARK: - Previews

#Preview("Idle") {
    VStack {
        Spacer()
        ComposerView(
            sessionId: "s1", isConnected: true, isStreaming: false,
            onSend: { print("Send: \($0)") }, onInterrupt: {}
        )
    }
    .background(AmplinkColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}

// ComposerView — Two-layer input system: action tray + text input.
//
// Ported from Talkie's ActionDock with a key architectural change:
// the tray is controls only — text input is a separate layer above it.
//
// Layer 1 (bottom, always visible): Action Tray
//   [attachment 48pt] — Spacer — [mic 70pt] — Spacer — [keyboard 48pt]
//   iOS 26 Liquid Glass (.glassEffect(.regular.interactive()))
//   Pre-iOS 26: chrome metallic (.ultraThinMaterial + edge highlight)
//   Push-to-talk overlay + recording indicator within the glass
//
// Layer 2 (above tray, toggled): Text Input
//   Multi-line text field + send/interrupt buttons
//   Toggled by keyboard button, dismissed back to tray-only
//
// Public interface (unchanged for TimelineView):
//   sessionId, isConnected, isStreaming, onSend, onInterrupt

import SwiftUI

struct ComposerView: View {
    let sessionId: String
    let isConnected: Bool
    let isStreaming: Bool
    let onSend: (String) -> Void
    let onInterrupt: () -> Void

    @State private var text = ""
    @State private var showTextInput = false
    @FocusState private var isFocused: Bool

    // Voice engine
    @StateObject private var voice = PlexusVoice()

    // Recording state
    @State private var micState: MicButtonState = .idle
    @State private var isPushToTalk = false
    @State private var lastError: String?

    // Derived
    private var isRecording: Bool { micState == .recording }
    private var isTranscribing: Bool { micState == .transcribing }

    private var canSend: Bool {
        isConnected
            && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isStreaming
    }

    var body: some View {
        VStack(spacing: 0) {
            // Debug: show last error so we can see what's failing on device
            if let lastError {
                Text(lastError)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
                    .background(Color.red.opacity(0.85))
                    .onTapGesture { self.lastError = nil }
            }

            // Layer 2: Text Input (above tray, toggled)
            if showTextInput && !isRecording && !isTranscribing {
                textInputLayer
                    .transition(.asymmetric(
                        insertion: .move(edge: .bottom).combined(with: .opacity),
                        removal: .move(edge: .bottom).combined(with: .opacity)
                    ))
            }

            // Layer 1: Action Tray (always visible at bottom)
            actionTray
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: showTextInput)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isRecording)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isTranscribing)
        .accessibilityElement(children: .contain)
        .task {
            await voice.prepare()
        }
    }

    // MARK: - Layer 1: Action Tray

    private var actionTray: some View {
        VStack(spacing: 0) {
            // Recording indicator overlay (above button row, within the glass)
            if isRecording || isTranscribing {
                RecordingIndicator(
                    phase: isRecording
                        ? .recording(isPushToTalk: isPushToTalk)
                        : .transcribing,
                    duration: voice.recordingDuration,
                    audioLevels: voice.audioLevels
                )
                .padding(.horizontal, PlexusSpacing.lg)
                .padding(.top, PlexusSpacing.sm)
                .transition(.asymmetric(
                    insertion: .move(edge: .bottom).combined(with: .opacity),
                    removal: .scale(scale: 0.95).combined(with: .opacity)
                ))
            }

            // 3-button HStack: attachment — mic — keyboard
            buttonRow
                .padding(.horizontal, PlexusSpacing.lg)
                .padding(.top, isRecording || isTranscribing ? PlexusSpacing.sm : 18)
                .padding(.bottom, 20)
        }
        .frame(maxWidth: .infinity)
        .background { trayBackground }
    }

    // MARK: - Tray Background (Liquid Glass / Chrome Metallic)

    private var trayBackground: some View {
        Color.clear
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 0))
            .ignoresSafeArea(edges: .bottom)
    }

    // MARK: - Button Row

    private var buttonRow: some View {
        HStack(spacing: 0) {
            // Left: attachment or cancel
            leftTrayButton
                .frame(width: 48, height: 48)

            Spacer()

            // Center: 70pt mic
            MicButton(
                state: currentMicState,
                onTap: handleMicTap,
                onLongPressStart: handlePushToTalkStart,
                onLongPressEnd: handlePushToTalkEnd
            )

            Spacer()

            // Right: keyboard / interrupt
            rightTrayButton
                .frame(width: 48, height: 48)
        }
    }

    // MARK: - Left Tray Button

    @ViewBuilder
    private var leftTrayButton: some View {
        if isRecording || isTranscribing {
            BottomCircleButton(icon: "xmark", isActive: false) {
                cancelRecording()
            }
            .transition(.scale.combined(with: .opacity))
            .accessibilityLabel("Cancel recording")
        } else {
            BottomCircleButton(icon: "paperclip.circle", isActive: false) {
                // Attachment action (placeholder for now)
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
            }
            .accessibilityLabel("Attach file")
        }
    }

    // MARK: - Right Tray Button

    @ViewBuilder
    private var rightTrayButton: some View {
        if isRecording || isTranscribing {
            // Empty placeholder during recording
            Color.clear.frame(width: 48, height: 48)
        } else if isStreaming {
            // Interrupt button
            Button {
                onInterrupt()
            } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PlexusColors.statusError)
                    .frame(width: 44, height: 44)
                    .background(PlexusColors.statusError.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .buttonStyle(.plain)
            .transition(.scale.combined(with: .opacity))
            .accessibilityLabel("Interrupt")
            .accessibilityHint("Stop the current response")
        } else {
            // Keyboard toggle
            BottomCircleButton(
                icon: showTextInput ? "keyboard.chevron.compact.down" : "keyboard",
                isActive: showTextInput
            ) {
                withAnimation {
                    showTextInput.toggle()
                    if showTextInput {
                        isFocused = true
                    } else {
                        isFocused = false
                    }
                }
            }
            .accessibilityLabel(showTextInput ? "Hide keyboard" : "Show keyboard")
        }
    }

    // MARK: - Layer 2: Text Input

    private var textInputLayer: some View {
        VStack(spacing: 0) {
            Divider()
                .background(PlexusColors.divider)

            // Text display + action buttons
            HStack(alignment: .bottom, spacing: PlexusSpacing.sm) {
                // Text display area (no native keyboard)
                textDisplay

                // Send / interrupt buttons
                HStack(spacing: PlexusSpacing.xs) {
                    if isStreaming {
                        Button {
                            onInterrupt()
                        } label: {
                            Image(systemName: "stop.fill")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(PlexusColors.statusError)
                                .frame(width: 36, height: 36)
                                .background(PlexusColors.statusError.opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: PlexusRadius.sm, style: .continuous))
                        }
                        .transition(.scale.combined(with: .opacity))
                        .accessibilityLabel("Interrupt")
                    }

                    if canSend {
                        Button {
                            sendIfPossible()
                        } label: {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(width: 36, height: 36)
                                .background(PlexusColors.accent)
                                .clipShape(RoundedRectangle(cornerRadius: PlexusRadius.sm, style: .continuous))
                        }
                        .transition(.scale.combined(with: .opacity))
                        .accessibilityLabel("Send message")
                    }
                }
                .animation(.easeInOut(duration: 0.15), value: isStreaming)
                .animation(.easeInOut(duration: 0.15), value: canSend)
            }
            .padding(.horizontal, PlexusSpacing.lg)
            .padding(.vertical, PlexusSpacing.md)

            // Custom UIKit keyboard (ported from Talkie's CompactKeyboardView)
            PlexusKeyboardView(
                text: $text,
                dictationState: keyboardDictationState,
                onInsert: { char in text.append(char) },
                onDelete: {
                    if !text.isEmpty { text.removeLast() }
                },
                onReturn: { sendIfPossible() },
                onVoice: { handleMicTap() },
                onDismiss: {
                    withAnimation {
                        showTextInput = false
                    }
                }
            )
        }
        .background(PlexusColors.backgroundAdaptive)
    }

    /// Text display that doesn't trigger native keyboard.
    private var textDisplay: some View {
        Group {
            if text.isEmpty {
                Text("Ask anything...")
                    .font(PlexusTypography.body(15))
                    .foregroundStyle(PlexusColors.textMuted)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
            } else {
                Text(text)
                    .font(PlexusTypography.body(15))
                    .foregroundStyle(PlexusColors.textPrimary)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                    .lineLimit(1...6)
            }
        }
        .opacity(isConnected ? 1.0 : 0.5)
        .accessibilityLabel("Message input")
    }

    private var keyboardDictationState: DictationState {
        if isRecording { return .recording }
        if isTranscribing { return .processing }
        return .idle
    }

    // MARK: - Mic State

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
        let impact = UIImpactFeedbackGenerator(style: .light)
        impact.impactOccurred()
        onSend(trimmed)
        text = ""
        showTextInput = false
        isFocused = false
    }

    // MARK: - Tap-to-Record

    private func handleMicTap() {
        switch micState {
        case .idle:
            isPushToTalk = false
            startRecording()
        case .recording:
            stopRecording()
        case .transcribing, .disabled:
            break
        }
    }

    // MARK: - Push-to-Talk

    private func handlePushToTalkStart() {
        guard micState == .idle else { return }
        isPushToTalk = true
        startRecording()
    }

    private func handlePushToTalkEnd() {
        guard micState == .recording, isPushToTalk else { return }
        stopRecording()
    }

    // MARK: - Recording Flow

    private func startRecording() {
        micState = .recording
        showTextInput = false
        isFocused = false
        lastError = nil

        Task {
            do {
                if !voice.isReady {
                    await voice.prepare()
                }
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
            do {
                let transcribed = try await voice.stopAndTranscribe()
                text = transcribed
                micState = .idle
                isPushToTalk = false
                showTextInput = true
                isFocused = true
            } catch PlexusVoice.VoiceError.recordingTooShort {
                lastError = "Recording too short (min 0.3s)"
                micState = .idle
                isPushToTalk = false
            } catch {
                lastError = "Transcription: \(error.localizedDescription)"
                micState = .idle
                isPushToTalk = false
            }
        }
    }

    private func cancelRecording() {
        voice.cancelRecording()
        micState = .idle
        isPushToTalk = false
    }
}

// MARK: - Previews

#Preview("Tray Only - Idle") {
    VStack {
        Spacer()
        ComposerView(
            sessionId: "s1",
            isConnected: true,
            isStreaming: false,
            onSend: { print("Send: \($0)") },
            onInterrupt: { print("Interrupt") }
        )
    }
    .background(PlexusColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}

#Preview("Tray - Streaming") {
    VStack {
        Spacer()
        ComposerView(
            sessionId: "s1",
            isConnected: true,
            isStreaming: true,
            onSend: { print("Send: \($0)") },
            onInterrupt: { print("Interrupt") }
        )
    }
    .background(PlexusColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}

#Preview("Tray - Disconnected") {
    VStack {
        Spacer()
        ComposerView(
            sessionId: "s1",
            isConnected: false,
            isStreaming: false,
            onSend: { print("Send: \($0)") },
            onInterrupt: { print("Interrupt") }
        )
    }
    .background(PlexusColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}

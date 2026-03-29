// ComposerView — Prompt input at the bottom of the timeline.
//
// Multi-line text field, send button, attach button.
// Keyboard-aware, disabled when disconnected.

import SwiftUI

struct ComposerView: View {
    let sessionId: String
    let isConnected: Bool
    let isStreaming: Bool
    let onSend: (String) -> Void
    let onInterrupt: () -> Void

    @State private var text = ""
    @FocusState private var isFocused: Bool

    private var canSend: Bool {
        isConnected && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isStreaming
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
                .background(PlexusColors.divider)

            HStack(alignment: .bottom, spacing: PlexusSpacing.sm) {
                attachButton

                textField

                if isStreaming {
                    interruptButton
                } else {
                    sendButton
                }
            }
            .padding(.horizontal, PlexusSpacing.md)
            .padding(.vertical, PlexusSpacing.sm)
            .background(PlexusColors.backgroundAdaptive)
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: - Text Field

    private var textField: some View {
        TextField("Ask anything...", text: $text, axis: .vertical)
            .font(PlexusTypography.body(15))
            .foregroundStyle(PlexusColors.textPrimary)
            .lineLimit(1...6)
            .focused($isFocused)
            .textFieldStyle(.plain)
            .padding(.horizontal, PlexusSpacing.md)
            .padding(.vertical, PlexusSpacing.sm)
            .background(PlexusColors.surfaceAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: PlexusRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PlexusRadius.lg, style: .continuous)
                    .strokeBorder(
                        isFocused ? PlexusColors.accent.opacity(0.5) : PlexusColors.border,
                        lineWidth: isFocused ? 1.5 : 0.5
                    )
            )
            .disabled(!isConnected)
            .opacity(isConnected ? 1.0 : 0.5)
            .onSubmit {
                sendIfPossible()
            }
            .accessibilityLabel("Message input")
            .accessibilityHint(isConnected ? "Type a message to send to the agent" : "Disconnected, cannot send messages")
    }

    // MARK: - Send Button

    private var sendButton: some View {
        Button {
            sendIfPossible()
        } label: {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 32))
                .foregroundStyle(canSend ? PlexusColors.accent : PlexusColors.textMuted.opacity(0.4))
                .symbolRenderingMode(.hierarchical)
        }
        .disabled(!canSend)
        .animation(.easeInOut(duration: 0.15), value: canSend)
        .accessibilityLabel("Send message")
        .accessibilityHint(canSend ? "Double tap to send" : "Enter a message first")
    }

    // MARK: - Interrupt Button

    private var interruptButton: some View {
        Button {
            onInterrupt()
        } label: {
            Image(systemName: "stop.circle.fill")
                .font(.system(size: 32))
                .foregroundStyle(PlexusColors.statusError)
                .symbolRenderingMode(.hierarchical)
        }
        .accessibilityLabel("Interrupt")
        .accessibilityHint("Stop the current response")
    }

    // MARK: - Attach Button

    private var attachButton: some View {
        Button {
            // Attachment picker (to be implemented with file/image selection)
        } label: {
            Image(systemName: "paperclip")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(isConnected ? PlexusColors.textSecondary : PlexusColors.textMuted.opacity(0.4))
        }
        .disabled(!isConnected)
        .padding(.bottom, 6)
        .accessibilityLabel("Attach file")
    }

    // MARK: - Actions

    private func sendIfPossible() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, canSend else { return }
        onSend(trimmed)
        text = ""
    }
}

// MARK: - Preview

#Preview {
    VStack {
        Spacer()

        ComposerView(
            sessionId: "s1",
            isConnected: true,
            isStreaming: false,
            onSend: { msg in print("Send: \(msg)") },
            onInterrupt: { print("Interrupt") }
        )
    }
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}

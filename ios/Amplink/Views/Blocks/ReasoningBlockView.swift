// ReasoningBlockView — Collapsible thinking/reasoning section.
//
// Expanded while streaming, collapsed by default when completed.
// Muted secondary text to convey supplementary nature.

import SwiftUI

struct ReasoningBlockView: View {
    let block: Block

    @State private var isExpanded: Bool

    private var isStreaming: Bool {
        block.status == .streaming || block.status == .started
    }

    private var displayText: String {
        block.text ?? ""
    }

    init(block: Block) {
        self.block = block
        // Expanded while streaming, collapsed when completed
        let streaming = block.status == .streaming || block.status == .started
        _isExpanded = State(initialValue: streaming)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if isExpanded {
                content
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .amplinkCard(padding: AmplinkSpacing.sm, cornerRadius: AmplinkRadius.sm)
        .background(AmplinkColors.reasoningBackground.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: AmplinkRadius.sm, style: .continuous))
        .animation(.easeInOut(duration: 0.25), value: isExpanded)
        .onChange(of: block.status) { _, newStatus in
            // Auto-collapse when streaming ends
            if newStatus == .completed || newStatus == .failed {
                withAnimation(.easeInOut(duration: 0.3)) {
                    isExpanded = false
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Reasoning block")
    }

    // MARK: - Header

    private var header: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.25)) {
                isExpanded.toggle()
            }
        } label: {
            HStack(spacing: AmplinkSpacing.sm) {
                Image(systemName: "brain")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AmplinkColors.textMuted)

                if isStreaming {
                    HStack(spacing: AmplinkSpacing.xs) {
                        Text("Thinking")
                            .font(AmplinkTypography.caption(13, weight: .medium))
                            .foregroundStyle(AmplinkColors.textSecondary)
                        TypingDots()
                    }
                } else {
                    Text("Thought process")
                        .font(AmplinkTypography.caption(13, weight: .medium))
                        .foregroundStyle(AmplinkColors.textMuted)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(AmplinkColors.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
            }
            .padding(.vertical, AmplinkSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isExpanded ? "Collapse reasoning" : "Expand reasoning")
        .accessibilityHint("Double tap to \(isExpanded ? "collapse" : "expand") the thinking process")
    }

    // MARK: - Content

    private var content: some View {
        VStack(alignment: .leading, spacing: AmplinkSpacing.xs) {
            Divider()
                .background(AmplinkColors.divider)

            HStack(alignment: .bottom, spacing: 0) {
                Text(displayText)
                    .font(AmplinkTypography.body(14))
                    .foregroundStyle(AmplinkColors.textSecondary)
                    .lineSpacing(2)
                    .textSelection(.enabled)

                if isStreaming {
                    StreamingCursor()
                        .padding(.leading, 2)
                }
            }
            .padding(.top, AmplinkSpacing.xs)
        }
    }
}

// MARK: - Typing Dots Animation

private struct TypingDots: View {
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<3) { i in
                Circle()
                    .fill(AmplinkColors.textMuted)
                    .frame(width: 3, height: 3)
                    .offset(y: dotOffset(for: i))
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: false)) {
                phase = 1.0
            }
        }
        .accessibilityHidden(true)
    }

    private func dotOffset(for index: Int) -> CGFloat {
        let delay = Double(index) * 0.2
        let progress = (phase + delay).truncatingRemainder(dividingBy: 1.0)
        return sin(progress * .pi * 2) * 2
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 16) {
        ReasoningBlockView(block: Block(
            id: "1", turnId: "t1", type: .reasoning, status: .streaming, index: 0,
            text: "Let me think about this step by step. The user wants to refactor the authentication module to use JWT tokens instead of session cookies..."
        ))

        ReasoningBlockView(block: Block(
            id: "2", turnId: "t1", type: .reasoning, status: .completed, index: 0,
            text: "I analyzed the codebase and found that the auth module currently uses express-session with Redis store. Migrating to JWT would simplify the architecture."
        ))
    }
    .padding()
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}

// TimelineView — Session detail screen showing a scrolling timeline of turns.
//
// Auto-scrolls to bottom during streaming. Shows prompt composer at the bottom.
// NavigationStack destination from the session list.

import SwiftUI

struct TimelineView: View {
    let sessionId: String

    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection

    @State private var shouldAutoScroll = true
    @Namespace private var bottomAnchor

    private var sessionState: SessionState? {
        store.sessions[sessionId]
    }

    private var session: Session? {
        sessionState?.session
    }

    private var turns: [Turn] {
        guard let state = sessionState else { return [] }
        // Convert TurnState -> Turn for rendering
        return state.turns.map { turnState in
            let turnStatus: TurnStatus = switch turnState.status {
            case .streaming: .streaming
            case .completed: .completed
            case .interrupted: .stopped
            case .error: .failed
            }

            let blocks = turnState.blocks.map(\.block)
            let startedAtDate = Date(timeIntervalSince1970: Double(turnState.startedAt) / 1000.0)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]

            return Turn(
                id: turnState.id,
                sessionId: sessionId,
                status: turnStatus,
                startedAt: formatter.string(from: startedAtDate),
                blocks: blocks
            )
        }
    }

    private var isStreaming: Bool {
        turns.last?.status == .streaming || turns.last?.status == .started
    }

    private var isConnected: Bool {
        connection.state == .connected
    }

    var body: some View {
        VStack(spacing: 0) {
            if turns.isEmpty {
                emptyState
            } else {
                timeline
            }

            ComposerView(
                sessionId: sessionId,
                isConnected: isConnected,
                isStreaming: isStreaming,
                onSend: { text in
                    Task {
                        let prompt = Prompt(sessionId: sessionId, text: text)
                        try? await connection.sendPrompt(prompt)
                    }
                },
                onInterrupt: {
                    Task {
                        try? await connection.interruptTurn(sessionId)
                    }
                }
            )
        }
        .background(PlexusColors.backgroundAdaptive)
        .navigationTitle(session?.name ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                titleView
            }
            ToolbarItem(placement: .topBarTrailing) {
                connectionIndicator
            }
        }
    }

    // MARK: - Timeline

    private var timeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(turns) { turn in
                        TurnView(turn: turn)

                        // Subtle divider between turns
                        if turn.id != turns.last?.id {
                            turnDivider
                        }
                    }

                    // Invisible anchor at the bottom for auto-scroll
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.top, PlexusSpacing.sm)
                .padding(.bottom, PlexusSpacing.md)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: turns.last?.blocks.count) { _, _ in
                if shouldAutoScroll {
                    scrollToBottom(proxy: proxy)
                }
            }
            .onChange(of: turns.count) { _, _ in
                if shouldAutoScroll {
                    scrollToBottom(proxy: proxy)
                }
            }
            .onChange(of: isStreaming) { _, streaming in
                if streaming {
                    shouldAutoScroll = true
                    scrollToBottom(proxy: proxy)
                }
            }
            .onAppear {
                scrollToBottom(proxy: proxy)
            }
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.25)) {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }

    private var turnDivider: some View {
        Rectangle()
            .fill(PlexusColors.divider)
            .frame(height: 0.5)
            .padding(.horizontal, PlexusSpacing.xl)
            .padding(.vertical, PlexusSpacing.sm)
    }

    // MARK: - Title

    private var titleView: some View {
        HStack(spacing: PlexusSpacing.sm) {
            if let session {
                Image(systemName: AdapterIcon.systemName(for: session.adapterType))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PlexusColors.accent)
            }

            Text(session?.name ?? "Session")
                .font(PlexusTypography.body(16, weight: .semibold))
                .foregroundStyle(PlexusColors.textPrimary)
        }
    }

    // MARK: - Connection Indicator

    @ViewBuilder
    private var connectionIndicator: some View {
        switch connection.state {
        case .connected:
            Circle()
                .fill(PlexusColors.statusActive)
                .frame(width: 7, height: 7)
                .accessibilityLabel("Connected")
        case .connecting, .handshaking, .reconnecting:
            ProgressView()
                .controlSize(.mini)
                .accessibilityLabel("Connecting")
        case .disconnected, .failed:
            Circle()
                .fill(PlexusColors.statusError)
                .frame(width: 7, height: 7)
                .accessibilityLabel("Disconnected")
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: PlexusSpacing.lg) {
            Spacer()

            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.system(size: 40))
                .foregroundStyle(PlexusColors.textMuted.opacity(0.5))

            VStack(spacing: PlexusSpacing.sm) {
                Text("No turns yet")
                    .font(PlexusTypography.body(18, weight: .semibold))
                    .foregroundStyle(PlexusColors.textSecondary)

                Text("Send a prompt to start a conversation with the agent.")
                    .font(PlexusTypography.body(14))
                    .foregroundStyle(PlexusColors.textMuted)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .padding(.horizontal, PlexusSpacing.xxl)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        TimelineView(sessionId: "s1")
            .environment(SessionStore.preview)
            .environment(ConnectionManager.preview())
    }
    .preferredColorScheme(.dark)
}

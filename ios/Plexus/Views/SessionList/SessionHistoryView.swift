// SessionHistoryView — Browse cached sessions offline.
//
// Read-only viewer for past sessions stored on-device.
// Works without a bridge connection. Shows cached turns and blocks.

import SwiftUI

struct SessionHistoryView: View {
    @State private var cachedSessions: [SessionCache.CachedSessionInfo] = []
    @State private var selectedSessionId: String?

    var body: some View {
        NavigationStack {
            Group {
                if cachedSessions.isEmpty {
                    emptyState
                } else {
                    sessionList
                }
            }
            .background(PlexusColors.backgroundAdaptive)
            .navigationTitle("History")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(item: $selectedSessionId) { sessionId in
                CachedSessionView(sessionId: sessionId)
            }
        }
        .task {
            cachedSessions = SessionCache.shared.loadIndex()
        }
    }

    private var sessionList: some View {
        List {
            ForEach(cachedSessions, id: \.id) { info in
                Button {
                    selectedSessionId = info.id
                } label: {
                    HStack(spacing: PlexusSpacing.md) {
                        Image(systemName: AdapterIcon.systemName(for: info.adapterType))
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(PlexusColors.accent)
                            .frame(width: 32)

                        VStack(alignment: .leading, spacing: 3) {
                            Text(info.name)
                                .font(PlexusTypography.body(15, weight: .medium))
                                .foregroundStyle(PlexusColors.textPrimary)
                            HStack(spacing: PlexusSpacing.sm) {
                                Text(AdapterIcon.displayName(for: info.adapterType))
                                    .font(PlexusTypography.caption(12))
                                    .foregroundStyle(PlexusColors.textMuted)
                                Text("\(info.turnCount) turns")
                                    .font(PlexusTypography.caption(12))
                                    .foregroundStyle(PlexusColors.textMuted)
                                Text(RelativeTime.string(from: info.cachedAt))
                                    .font(PlexusTypography.caption(12))
                                    .foregroundStyle(PlexusColors.textMuted)
                            }
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(PlexusColors.textMuted)
                    }
                }
                .listRowBackground(PlexusColors.backgroundAdaptive)
            }
            .onDelete { indexSet in
                for index in indexSet {
                    SessionCache.shared.delete(sessionId: cachedSessions[index].id)
                }
                cachedSessions.remove(atOffsets: indexSet)
            }
        }
        .listStyle(.plain)
    }

    private var emptyState: some View {
        VStack(spacing: PlexusSpacing.lg) {
            Spacer()
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 36))
                .foregroundStyle(PlexusColors.textMuted)
            Text("No cached sessions")
                .font(PlexusTypography.body(16, weight: .medium))
                .foregroundStyle(PlexusColors.textSecondary)
            Text("Sessions are cached locally as you use them.\nView them here anytime, even offline.")
                .font(PlexusTypography.body(14))
                .foregroundStyle(PlexusColors.textMuted)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(.horizontal, PlexusSpacing.xxl)
    }
}

// MARK: - Cached Session Viewer (read-only timeline)

struct CachedSessionView: View {
    let sessionId: String
    @State private var state: SessionState?

    private var turns: [Turn] {
        guard let state else { return [] }
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

    var body: some View {
        Group {
            if turns.isEmpty {
                VStack {
                    Spacer()
                    Text("No cached turns")
                        .font(PlexusTypography.body(15))
                        .foregroundStyle(PlexusColors.textMuted)
                    Spacer()
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        // Offline banner
                        HStack(spacing: PlexusSpacing.sm) {
                            Image(systemName: "internaldrive")
                                .font(.system(size: 12))
                            Text("Cached locally — read only")
                                .font(PlexusTypography.caption(12, weight: .medium))
                        }
                        .foregroundStyle(PlexusColors.textMuted)
                        .padding(.vertical, PlexusSpacing.sm)

                        ForEach(turns) { turn in
                            TurnView(turn: turn)
                        }
                    }
                    .padding(.top, PlexusSpacing.sm)
                    .padding(.bottom, PlexusSpacing.md)
                }
            }
        }
        .background(PlexusColors.backgroundAdaptive)
        .navigationTitle(state?.session.name ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            state = SessionCache.shared.load(sessionId: sessionId)
        }
    }
}

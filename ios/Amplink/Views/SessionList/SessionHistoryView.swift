// SessionHistoryView — Browse cached sessions offline.
//
// Read-only viewer for past sessions stored on-device.
// Works without a bridge connection. Shows cached turns and blocks.

import SwiftUI

struct SessionHistoryView: View {
    var onResumed: ((String) -> Void)?

    @Environment(ConnectionManager.self) private var connection
    @Environment(\.dismiss) private var dismiss

    @State private var cachedSessions: [SessionCache.CachedSessionInfo] = []
    @State private var selectedSessionId: String?
    @State private var isResuming = false

    var body: some View {
        NavigationStack {
            Group {
                if cachedSessions.isEmpty {
                    emptyState
                } else {
                    sessionList
                }
            }
            .background(AmplinkColors.backgroundAdaptive)
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
                    HStack(spacing: AmplinkSpacing.md) {
                        Image(systemName: AdapterIcon.systemName(for: info.adapterType))
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(AmplinkColors.accent)
                            .frame(width: 32)

                        VStack(alignment: .leading, spacing: 3) {
                            Text(info.name)
                                .font(AmplinkTypography.body(15, weight: .medium))
                                .foregroundStyle(AmplinkColors.textPrimary)
                            HStack(spacing: AmplinkSpacing.sm) {
                                Text(AdapterIcon.displayName(for: info.adapterType))
                                    .font(AmplinkTypography.caption(12))
                                    .foregroundStyle(AmplinkColors.textMuted)
                                Text("\(info.turnCount) turns")
                                    .font(AmplinkTypography.caption(12))
                                    .foregroundStyle(AmplinkColors.textMuted)
                                Text(RelativeTime.string(from: info.cachedAt))
                                    .font(AmplinkTypography.caption(12))
                                    .foregroundStyle(AmplinkColors.textMuted)
                            }
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(AmplinkColors.textMuted)
                    }
                }
                .listRowBackground(AmplinkColors.backgroundAdaptive)
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

    private func resumeSession(_ info: SessionCache.CachedSessionInfo) {
        guard !isResuming else { return }
        isResuming = true

        Task {
            do {
                let cached = SessionCache.shared.load(sessionId: info.id)
                let newSession = try await connection.createSession(
                    adapterType: info.adapterType,
                    name: info.name,
                    cwd: cached?.session.cwd
                )
                dismiss()
                try? await Task.sleep(for: .milliseconds(300))
                onResumed?(newSession.id)
            } catch {
                AmplinkLog.session.error("Resume from history failed: \(error.localizedDescription)")
            }
            isResuming = false
        }
    }

    private var emptyState: some View {
        VStack(spacing: AmplinkSpacing.lg) {
            Spacer()
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 36))
                .foregroundStyle(AmplinkColors.textMuted)
            Text("No cached sessions")
                .font(AmplinkTypography.body(16, weight: .medium))
                .foregroundStyle(AmplinkColors.textSecondary)
            Text("Sessions are cached locally as you use them.\nView them here anytime, even offline.")
                .font(AmplinkTypography.body(14))
                .foregroundStyle(AmplinkColors.textMuted)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(.horizontal, AmplinkSpacing.xxl)
    }
}

// MARK: - Cached Session Viewer (read-only timeline)

struct CachedSessionView: View {
    let sessionId: String

    @Environment(ConnectionManager.self) private var connection
    @Environment(SessionStore.self) private var store
    @State private var state: SessionState?
    @State private var isFetchingFromBridge = false
    @State private var fetchError: String?
    @State private var liveSessionId: String?
    @State private var isResuming = false

    private var isConnected: Bool { connection.state == .connected }
    private var isLive: Bool { liveSessionId != nil }

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

    /// Live turns from store (after resume)
    private var liveTurns: [Turn] {
        guard let sid = liveSessionId, let liveState = store.sessions[sid] else { return [] }
        return liveState.turns.map { turnState in
            let turnStatus: TurnStatus = switch turnState.status {
            case .streaming: .streaming
            case .completed: .completed
            case .interrupted: .stopped
            case .error: .failed
            }
            return Turn(
                id: turnState.id,
                sessionId: sid,
                status: turnStatus,
                startedAt: ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: Double(turnState.startedAt) / 1000.0)),
                blocks: turnState.blocks.map(\.block),
                isUserTurn: turnState.isUserTurn
            )
        }
    }

    private var allTurns: [Turn] { turns + liveTurns }

    private var isStreaming: Bool {
        allTurns.last?.status == .streaming || allTurns.last?.status == .started
    }

    private var activeSessionId: String { liveSessionId ?? sessionId }

    var body: some View {
        VStack(spacing: 0) {
            if allTurns.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(allTurns) { turn in
                            TurnView(turn: turn)
                        }
                    }
                    .padding(.top, AmplinkSpacing.sm)
                    .padding(.bottom, AmplinkSpacing.md)
                }
            }

            // Always show composer when connected
            if isConnected {
                ComposerView(
                    sessionId: activeSessionId,
                    projectName: state?.session.name,
                    isConnected: isConnected,
                    isStreaming: isStreaming,
                    onSend: { text in sendMessage(text) },
                    onInterrupt: {
                        if let sid = liveSessionId {
                            Task { try? await connection.interruptTurn(sid) }
                        }
                    }
                )
            }
        }
        .background(AmplinkColors.backgroundAdaptive)
        .navigationTitle(state?.session.name ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            state = SessionCache.shared.load(sessionId: sessionId)
            if (state == nil || state?.turns.isEmpty == true), isConnected {
                await fetchFromBridge()
            }
        }
    }

    /// Send a message — transparently creates a bridge session on first send.
    private func sendMessage(_ text: String) {
        Task {
            // Create bridge session on first send
            if liveSessionId == nil, let session = state?.session {
                do {
                    let newSession = try await connection.createSession(
                        adapterType: session.adapterType,
                        name: session.name,
                        cwd: session.cwd
                    )
                    liveSessionId = newSession.id
                } catch {
                    fetchError = "Could not start session: \(error.localizedDescription)"
                    return
                }
            }

            guard let sid = liveSessionId else { return }

            store.appendLocalUserTurn(text: text, sessionId: sid)

            // Send to bridge
            try? await connection.sendPrompt(Prompt(sessionId: sid, text: text))
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: AmplinkSpacing.xl) {
                // Icon
                ZStack {
                    Circle()
                        .fill(AmplinkColors.accent.opacity(0.08))
                        .frame(width: 72, height: 72)
                    Image(systemName: "text.document")
                        .font(.system(size: 28, weight: .light))
                        .foregroundStyle(AmplinkColors.accent.opacity(0.5))
                }

                VStack(spacing: AmplinkSpacing.sm) {
                    Text("No turns cached")
                        .font(AmplinkTypography.body(17, weight: .semibold))
                        .foregroundStyle(AmplinkColors.textPrimary)

                    if let session = state?.session {
                        // Show what we know about this session
                        HStack(spacing: AmplinkSpacing.md) {
                            Label(
                                AdapterIcon.displayName(for: session.adapterType),
                                systemImage: AdapterIcon.systemName(for: session.adapterType)
                            )
                            .font(AmplinkTypography.caption(12, weight: .medium))
                            .foregroundStyle(AmplinkColors.textSecondary)

                            Text(session.status.rawValue)
                                .font(AmplinkTypography.caption(12))
                                .foregroundStyle(AmplinkColors.textMuted)
                        }
                    }

                    Text("This session was saved but had no conversation turns.\nIt may have just been created.")
                        .font(AmplinkTypography.body(14))
                        .foregroundStyle(AmplinkColors.textMuted)
                        .multilineTextAlignment(.center)
                        .padding(.top, AmplinkSpacing.xxs)
                }

                // Fetch from bridge button
                if isConnected {
                    VStack(spacing: AmplinkSpacing.sm) {
                        Button {
                            Task { await fetchFromBridge() }
                        } label: {
                            HStack(spacing: AmplinkSpacing.sm) {
                                if isFetchingFromBridge {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Image(systemName: "arrow.down.circle")
                                        .font(.system(size: 14, weight: .semibold))
                                }
                                Text(isFetchingFromBridge ? "Fetching..." : "Fetch from bridge")
                                    .font(AmplinkTypography.body(14, weight: .semibold))
                            }
                            .padding(.horizontal, AmplinkSpacing.xl)
                            .padding(.vertical, AmplinkSpacing.md)
                            .background(AmplinkColors.accent)
                            .foregroundStyle(.white)
                            .clipShape(Capsule())
                        }
                        .disabled(isFetchingFromBridge)

                        if let fetchError {
                            Text(fetchError)
                                .font(AmplinkTypography.caption(12))
                                .foregroundStyle(AmplinkColors.statusError)
                        }
                    }
                } else {
                    HStack(spacing: AmplinkSpacing.xs) {
                        Circle()
                            .fill(AmplinkColors.statusIdle)
                            .frame(width: 6, height: 6)
                        Text("Connect to bridge to fetch session data")
                            .font(AmplinkTypography.caption(12))
                            .foregroundStyle(AmplinkColors.textMuted)
                    }
                    .padding(.top, AmplinkSpacing.xs)
                }
            }

            Spacer()
        }
        .padding(.horizontal, AmplinkSpacing.xxl)
    }

    // MARK: - Resume

    private func resumeFromCache() async {
        guard let session = state?.session else { return }
        isResuming = true
        do {
            let newSession = try await connection.createSession(
                adapterType: session.adapterType,
                name: session.name,
                cwd: session.cwd
            )
            liveSessionId = newSession.id
            AmplinkLog.session.info("Resumed cached session as \(newSession.id)")
        } catch {
            fetchError = "Resume failed: \(error.localizedDescription)"
        }
        isResuming = false
    }

    // MARK: - Bridge Fetch

    private func fetchFromBridge() async {
        isFetchingFromBridge = true
        fetchError = nil
        do {
            let snapshot = try await connection.getSnapshot(sessionId)
            state = snapshot
            // Update the local cache with fresh data
            if !snapshot.turns.isEmpty {
                SessionCache.shared.save(snapshot)
            }
        } catch {
            fetchError = "Could not fetch: \(error.localizedDescription)"
        }
        isFetchingFromBridge = false
    }
}

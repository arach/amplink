// SessionDiscoveryView — Browse past sessions from the bridge's history/discover RPC.
//
// Groups discovered JSONL sessions by project, sorted by recency.
// Tapping a session opens it in SpectatorView (WKWebView).
// Presented as a sheet from the meta-agent button in the action tray.

import SwiftUI

struct SessionDiscoveryView: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(\.dismiss) private var dismiss

    @State private var sessions: [DiscoveredSession] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var selectedSession: DiscoveredSession?

    private var groupedByProject: [(project: String, sessions: [DiscoveredSession])] {
        let grouped = Dictionary(grouping: sessions) { $0.project }
        return grouped
            .map { (project: $0.key, sessions: $0.value) }
            .sorted { lhs, rhs in
                let lhsLatest = lhs.sessions.map(\.modifiedAt).max() ?? 0
                let rhsLatest = rhs.sessions.map(\.modifiedAt).max() ?? 0
                return lhsLatest > rhsLatest
            }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    loadingState
                } else if let error {
                    errorState(error)
                } else if sessions.isEmpty {
                    emptyState
                } else {
                    sessionList
                }
            }
            .background(PlexusColors.backgroundAdaptive)
            .navigationTitle("Sessions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(PlexusColors.textMuted)
                            .symbolRenderingMode(.hierarchical)
                    }
                }
            }
            .fullScreenCover(item: $selectedSession) { session in
                SpectatorView(sessionPath: session.path, sessionName: session.project)
            }
        }
        .task {
            await loadSessions()
        }
    }

    // MARK: - Session List

    private var sessionList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(groupedByProject, id: \.project) { group in
                    projectSection(group.project, sessions: group.sessions)
                }
            }
            .padding(.top, PlexusSpacing.sm)
        }
    }

    private func projectSection(_ project: String, sessions: [DiscoveredSession]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Project header
            HStack(spacing: PlexusSpacing.sm) {
                Image(systemName: agentIcon(for: sessions.first?.agent ?? "unknown"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PlexusColors.accent)
                Text(project)
                    .font(PlexusTypography.caption(13, weight: .semibold))
                    .foregroundStyle(PlexusColors.textSecondary)
                    .textCase(.uppercase)
                    .tracking(0.5)
                Spacer()
                Text("\(sessions.count)")
                    .font(PlexusTypography.caption(12, weight: .medium))
                    .foregroundStyle(PlexusColors.textMuted)
            }
            .padding(.horizontal, PlexusSpacing.lg)
            .padding(.vertical, PlexusSpacing.md)

            // Session rows
            ForEach(sessions) { session in
                sessionRow(session)
            }
        }
    }

    private func sessionRow(_ session: DiscoveredSession) -> some View {
        Button {
            selectedSession = session
        } label: {
            HStack(spacing: PlexusSpacing.md) {
                // File indicator
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(PlexusColors.accent.opacity(0.15))
                    .frame(width: 4, height: 32)

                VStack(alignment: .leading, spacing: 3) {
                    // Session file name (last path component, trimmed)
                    Text(sessionDisplayName(session.path))
                        .font(PlexusTypography.code(13, weight: .medium))
                        .foregroundStyle(PlexusColors.textPrimary)
                        .lineLimit(1)

                    HStack(spacing: PlexusSpacing.md) {
                        Label(AdapterIcon.displayName(for: session.agent), systemImage: agentIcon(for: session.agent))
                            .font(PlexusTypography.caption(11))
                            .foregroundStyle(PlexusColors.textMuted)

                        Text("\(session.lineCount) lines")
                            .font(PlexusTypography.caption(11))
                            .foregroundStyle(PlexusColors.textMuted)

                        Text(RelativeTime.string(from: session.modifiedDate))
                            .font(PlexusTypography.caption(11))
                            .foregroundStyle(PlexusColors.textMuted)
                    }
                }

                Spacer()

                Image(systemName: "play.circle")
                    .font(.system(size: 20, weight: .light))
                    .foregroundStyle(PlexusColors.accent.opacity(0.6))
            }
            .padding(.horizontal, PlexusSpacing.lg)
            .padding(.vertical, PlexusSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: PlexusSpacing.lg) {
            Spacer()
            ProgressView()
                .controlSize(.regular)
            Text("Scanning sessions...")
                .font(PlexusTypography.body(14))
                .foregroundStyle(PlexusColors.textMuted)
            Spacer()
        }
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: PlexusSpacing.lg) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundStyle(PlexusColors.statusError)
            Text(message)
                .font(PlexusTypography.body(14))
                .foregroundStyle(PlexusColors.textSecondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await loadSessions() }
            }
            .font(PlexusTypography.body(14, weight: .medium))
            .foregroundStyle(PlexusColors.accent)
            Spacer()
        }
        .padding(.horizontal, PlexusSpacing.xxl)
    }

    private var emptyState: some View {
        VStack(spacing: PlexusSpacing.lg) {
            Spacer()
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 36))
                .foregroundStyle(PlexusColors.textMuted)
            Text("No sessions found")
                .font(PlexusTypography.body(16, weight: .medium))
                .foregroundStyle(PlexusColors.textSecondary)
            Text("No JSONL session files found in the last 14 days.")
                .font(PlexusTypography.body(14))
                .foregroundStyle(PlexusColors.textMuted)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(.horizontal, PlexusSpacing.xxl)
    }

    // MARK: - Data

    private func loadSessions() async {
        isLoading = true
        error = nil
        do {
            let response = try await connection.historyDiscover(maxAge: 14, limit: 50)
            sessions = response.sessions
        } catch {
            self.error = "Failed to discover sessions: \(error.localizedDescription)"
        }
        isLoading = false
    }

    // MARK: - Helpers

    private func sessionDisplayName(_ path: String) -> String {
        let filename = (path as NSString).lastPathComponent
        // Trim .jsonl extension and truncate long UUIDs
        let name = filename.replacingOccurrences(of: ".jsonl", with: "")
        if name.count > 24 {
            return String(name.prefix(10)) + "..." + String(name.suffix(8))
        }
        return name
    }

    private func agentIcon(for agent: String) -> String {
        switch agent.lowercased() {
        case "claude-code", "claude": "terminal"
        case "codex": "brain"
        case "aider": "text.cursor"
        default: "cpu"
        }
    }
}

// MARK: - Preview

#Preview {
    SessionDiscoveryView()
        .environment(ConnectionManager.preview())
        .preferredColorScheme(.dark)
}

// SessionListView — Home screen showing all sessions across connected bridges.
//
// Pull to refresh, empty state, "+" to create a new session,
// connection status indicator in the toolbar.

import SwiftUI

struct SessionListView: View {
    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection

    @State private var showingNewSession = false
    @State private var showingSettings = false
    @State private var showingHistory = false
    @State private var showingDiscovery = false
    @State private var isRefreshing = false
    @State private var navigateToSession: String?

    private var sortedSummaries: [SessionSummary] {
        store.summaries.sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    private var isConnected: Bool {
        connection.state == .connected
    }

    var body: some View {
        NavigationStack {
            Group {
                if sortedSummaries.isEmpty {
                    emptyState
                } else {
                    sessionList
                }
            }
            .background(AmplinkColors.backgroundAdaptive)
            .navigationTitle("Sessions")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    connectionStatusButton
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    discoveryButton
                    historyButton
                    settingsButton
                    newSessionButton
                }
            }
            .sheet(isPresented: $showingDiscovery) {
                SessionDiscoveryView(onResumed: { sessionId in
                    showingDiscovery = false
                    navigateToSession = sessionId
                })
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showingHistory) {
                SessionHistoryView(onResumed: { sessionId in
                    showingHistory = false
                    navigateToSession = sessionId
                })
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView()
                    .environment(connection)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showingNewSession) {
                WorkspaceBrowserView { sessionId in
                    // Auto-navigate to the newly created session
                    navigateToSession = sessionId
                }
            }
            .navigationDestination(item: $navigateToSession) { sessionId in
                TimelineView(sessionId: sessionId)
            }
        }
    }

    // MARK: - Session List

    private var sessionList: some View {
        List {
            ForEach(sortedSummaries) { summary in
                NavigationLink(value: summary.sessionId) {
                    SessionRowView(summary: summary)
                }
                .listRowBackground(AmplinkColors.backgroundAdaptive)
                .listRowSeparatorTint(AmplinkColors.divider)
            }
        }
        .listStyle(.plain)
        .refreshable {
            await refreshSessions()
        }
        .navigationDestination(for: String.self) { sessionId in
            TimelineView(sessionId: sessionId)
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: AmplinkSpacing.xl) {
            Spacer()

            VStack(spacing: AmplinkSpacing.lg) {
                ZStack {
                    Circle()
                        .fill(AmplinkColors.accent.opacity(0.08))
                        .frame(width: 80, height: 80)

                    Image(systemName: "rectangle.connected.to.line.below")
                        .font(.system(size: 32, weight: .light))
                        .foregroundStyle(AmplinkColors.accent.opacity(0.6))
                }

                VStack(spacing: AmplinkSpacing.sm) {
                    Text("No active sessions")
                        .font(AmplinkTypography.body(20, weight: .semibold))
                        .foregroundStyle(AmplinkColors.textPrimary)

                    if isConnected {
                        Text("Create a session to start working with an AI agent.")
                            .font(AmplinkTypography.body(15))
                            .foregroundStyle(AmplinkColors.textSecondary)
                            .multilineTextAlignment(.center)
                    } else {
                        Text("Connect to a bridge to see your sessions.")
                            .font(AmplinkTypography.body(15))
                            .foregroundStyle(AmplinkColors.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                }
            }

            if isConnected {
                Button {
                    showingNewSession = true
                } label: {
                    HStack(spacing: AmplinkSpacing.sm) {
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .semibold))
                        Text("New Session")
                            .font(AmplinkTypography.body(15, weight: .semibold))
                    }
                    .padding(.horizontal, AmplinkSpacing.xl)
                    .padding(.vertical, AmplinkSpacing.md)
                    .background(AmplinkColors.accent)
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
                }
            }

            Spacer()
        }
        .padding(.horizontal, AmplinkSpacing.xxl)
    }

    // MARK: - Connection Status

    private var connectionStatusButton: some View {
        HStack(spacing: AmplinkSpacing.xs) {
            connectionDot
            Text(connectionLabel)
                .font(AmplinkTypography.caption(12, weight: .medium))
                .foregroundStyle(AmplinkColors.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Connection: \(connectionLabel)")
    }

    @ViewBuilder
    private var connectionDot: some View {
        switch connection.state {
        case .connected:
            Circle()
                .fill(AmplinkColors.statusActive)
                .frame(width: 7, height: 7)
        case .connecting, .handshaking, .reconnecting:
            ProgressView()
                .controlSize(.mini)
        case .disconnected:
            Circle()
                .fill(AmplinkColors.statusIdle)
                .frame(width: 7, height: 7)
        case .failed:
            Circle()
                .fill(AmplinkColors.statusError)
                .frame(width: 7, height: 7)
        }
    }

    private var connectionLabel: String {
        switch connection.state {
        case .connected: "Connected"
        case .connecting: "Connecting"
        case .handshaking: "Handshaking"
        case .reconnecting: "Reconnecting"
        case .disconnected: "Disconnected"
        case .failed: "Connection Failed"
        }
    }

    // MARK: - Discovery

    private var discoveryButton: some View {
        Button {
            showingDiscovery = true
        } label: {
            Image(systemName: "sparkle.magnifyingglass")
                .font(.system(size: 16))
                .foregroundStyle(isConnected ? AmplinkColors.accent : AmplinkColors.textMuted)
        }
        .disabled(!isConnected)
        .accessibilityLabel("Browse past sessions")
    }

    // MARK: - History

    private var historyButton: some View {
        Button {
            showingHistory = true
        } label: {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 16))
                .foregroundStyle(AmplinkColors.textSecondary)
        }
        .accessibilityLabel("Session history")
    }

    // MARK: - Settings

    private var settingsButton: some View {
        Button {
            showingSettings = true
        } label: {
            Image(systemName: "gearshape")
                .font(.system(size: 17))
                .foregroundStyle(AmplinkColors.textSecondary)
        }
        .accessibilityLabel("Settings")
    }

    // MARK: - New Session

    private var newSessionButton: some View {
        Button {
            showingNewSession = true
        } label: {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(isConnected ? AmplinkColors.accent : AmplinkColors.textMuted.opacity(0.4))
                .symbolRenderingMode(.hierarchical)
        }
        .disabled(!isConnected)
        .accessibilityLabel("New session")
        .accessibilityHint(isConnected ? "Create a new AI agent session" : "Connect to a bridge first")
    }

    // MARK: - Refresh

    private func refreshSessions() async {
        isRefreshing = true
        do {
            _ = try await connection.bridgeStatus()
        } catch {
            // Silently handle -- the UI reflects connection state automatically
        }
        isRefreshing = false
    }
}

// MARK: - New Session Sheet

struct NewSessionSheet: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(\.dismiss) private var dismiss

    @State private var sessionName = ""
    @State private var selectedAdapter = "claude-code"

    private let adapters: [(id: String, name: String, icon: String)] = [
        ("claude-code", "Claude Code", "terminal"),
        ("openai", "OpenAI", "brain"),
        ("anthropic", "Anthropic", "sparkles"),
        ("groq", "Groq", "bolt.fill"),
        ("together", "Together", "square.stack.3d.up"),
        ("lm-studio", "LM Studio", "desktopcomputer"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Session name", text: $sessionName)
                        .font(AmplinkTypography.body())
                } header: {
                    Text("Name")
                        .font(AmplinkTypography.caption(12, weight: .medium))
                }

                Section {
                    ForEach(adapters, id: \.id) { adapter in
                        Button {
                            selectedAdapter = adapter.id
                        } label: {
                            HStack(spacing: AmplinkSpacing.md) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: AmplinkRadius.sm, style: .continuous)
                                        .fill(selectedAdapter == adapter.id
                                              ? AmplinkColors.accent.opacity(0.15)
                                              : AmplinkColors.surfaceAdaptive)
                                        .frame(width: 36, height: 36)

                                    Image(systemName: adapter.icon)
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundStyle(
                                            selectedAdapter == adapter.id
                                            ? AmplinkColors.accent
                                            : AmplinkColors.textSecondary
                                        )
                                }

                                Text(adapter.name)
                                    .font(AmplinkTypography.body(15, weight: .medium))
                                    .foregroundStyle(AmplinkColors.textPrimary)

                                Spacer()

                                if selectedAdapter == adapter.id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 18))
                                        .foregroundStyle(AmplinkColors.accent)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Adapter")
                        .font(AmplinkTypography.caption(12, weight: .medium))
                }
            }
            .navigationTitle("New Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        let name = sessionName.isEmpty ? nil : sessionName
                        Task {
                            _ = try? await connection.createSession(
                                adapterType: selectedAdapter,
                                name: name
                            )
                        }
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Preview

#Preview {
    SessionListView()
        .environment(SessionStore.preview)
        .environment(ConnectionManager.preview())
        .preferredColorScheme(.dark)
}

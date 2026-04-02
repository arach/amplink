// LogView — In-app debug log viewer.
//
// Shows AmplinkLog entries in real time. Filter by category or level.
// Scrolls to bottom automatically. Copy-all for sharing.

import SwiftUI

struct LogView: View {
    @ObservedObject private var store = LogStore.shared
    @State private var filterCategory: String?
    @State private var showErrorsOnly = false
    @State private var autoScroll = true

    private var filteredEntries: [LogEntry] {
        store.entries.filter { entry in
            if showErrorsOnly && entry.level != .error && entry.level != .fault {
                return false
            }
            if let cat = filterCategory, entry.category != cat {
                return false
            }
            return true
        }
    }

    private var categories: [String] {
        Array(Set(store.entries.map(\.category))).sorted()
    }

    var body: some View {
        VStack(spacing: 0) {
            // Filter bar
            filterBar

            Divider()

            // Log entries
            if filteredEntries.isEmpty {
                emptyState
            } else {
                logList
            }
        }
        .navigationTitle("Logs")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        copyAll()
                    } label: {
                        Label("Copy All", systemImage: "doc.on.doc")
                    }

                    Button(role: .destructive) {
                        store.clear()
                    } label: {
                        Label("Clear", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // Errors toggle
                FilterChip(
                    label: "Errors (\(store.errorCount))",
                    isActive: showErrorsOnly
                ) {
                    showErrorsOnly.toggle()
                }

                // Category filters
                ForEach(categories, id: \.self) { cat in
                    FilterChip(
                        label: cat,
                        isActive: filterCategory == cat
                    ) {
                        filterCategory = filterCategory == cat ? nil : cat
                    }
                }
            }
            .padding(.horizontal, AmplinkSpacing.md)
            .padding(.vertical, AmplinkSpacing.sm)
        }
    }

    // MARK: - Log List

    private var logList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(filteredEntries) { entry in
                        LogEntryRow(entry: entry)
                            .id(entry.id)
                    }
                }
            }
            .onChange(of: filteredEntries.count) {
                if autoScroll, let last = filteredEntries.last {
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    // MARK: - Empty

    private var emptyState: some View {
        VStack(spacing: AmplinkSpacing.md) {
            Spacer()
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 36))
                .foregroundStyle(AmplinkColors.textMuted)
            Text("No log entries")
                .font(AmplinkTypography.body(15))
                .foregroundStyle(AmplinkColors.textSecondary)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Copy

    private func copyAll() {
        let text = filteredEntries.map { entry in
            "[\(entry.timestampString)] [\(entry.level.rawValue)] [\(entry.category)] \(entry.message)"
                + (entry.detail.map { "\n  \($0)" } ?? "")
        }.joined(separator: "\n")

        UIPasteboard.general.string = text
    }
}

// MARK: - Log Entry Row

private struct LogEntryRow: View {
    let entry: LogEntry
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(entry.timestampString)
                    .font(AmplinkTypography.code(10))
                    .foregroundStyle(AmplinkColors.textMuted)

                Text(entry.category)
                    .font(AmplinkTypography.code(10, weight: .semibold))
                    .foregroundStyle(AmplinkColors.accent)

                Text(entry.level.rawValue)
                    .font(AmplinkTypography.code(10, weight: .bold))
                    .foregroundStyle(entry.level.color)

                Spacer()
            }

            Text(entry.message)
                .font(AmplinkTypography.code(12))
                .foregroundStyle(AmplinkColors.textPrimary)
                .lineLimit(expanded ? nil : 2)

            if let detail = entry.detail, expanded {
                Text(detail)
                    .font(AmplinkTypography.code(11))
                    .foregroundStyle(AmplinkColors.textSecondary)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, AmplinkSpacing.md)
        .padding(.vertical, AmplinkSpacing.xs)
        .contentShape(Rectangle())
        .onTapGesture {
            if entry.detail != nil {
                withAnimation(.easeInOut(duration: 0.15)) {
                    expanded.toggle()
                }
            }
        }
    }
}

// MARK: - Filter Chip

private struct FilterChip: View {
    let label: String
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(AmplinkTypography.caption(12, weight: .medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(isActive ? AmplinkColors.accent.opacity(0.15) : AmplinkColors.surfaceAdaptive)
                .foregroundStyle(isActive ? AmplinkColors.accent : AmplinkColors.textSecondary)
                .clipShape(Capsule())
                .overlay(
                    Capsule().strokeBorder(
                        isActive ? AmplinkColors.accent.opacity(0.3) : AmplinkColors.border,
                        lineWidth: 0.5
                    )
                )
        }
        .buttonStyle(.plain)
    }
}

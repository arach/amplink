// HarnessPickerView — Select an agentic harness for a project.
//
// Shows available agent runtimes (Claude Code, Codex, Aider, etc.)
// Same codebase, different agent — pick the lens.

import SwiftUI

// MARK: - Harness Definition

struct Harness: Identifiable, Hashable {
    let id: String          // adapter identifier sent to bridge
    let name: String        // display name
    let icon: String        // SF Symbol
    let description: String // one-liner
    let color: Color        // accent for the card

    static let builtIn: [Harness] = [
        Harness(
            id: "claude-code",
            name: "Claude Code",
            icon: "terminal",
            description: "Anthropic's agentic coding CLI",
            color: Color(red: 0.45, green: 0.65, blue: 1.0)
        ),
        Harness(
            id: "codex",
            name: "Codex",
            icon: "chevron.left.forwardslash.chevron.right",
            description: "OpenAI's coding agent",
            color: Color(red: 0.3, green: 0.85, blue: 0.5)
        ),
        Harness(
            id: "aider",
            name: "Aider",
            icon: "arrow.triangle.branch",
            description: "AI pair programming in your terminal",
            color: Color(red: 1.0, green: 0.6, blue: 0.2)
        ),
        Harness(
            id: "openai-compat",
            name: "OpenAI Compatible",
            icon: "brain",
            description: "GPT, Groq, Together, LM Studio, Ollama",
            color: Color(red: 0.7, green: 0.5, blue: 1.0)
        ),
    ]
}

// MARK: - HarnessPickerView

/// Configuration for launching a session — harness + optional overrides.
struct HarnessConfig {
    let harness: Harness
    var checkout: String?
    var model: String?
    var extensions: [String] = []
}

struct HarnessPickerView: View {
    let projectName: String
    let projectPath: String
    let onSelect: (Harness) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var selectedHarness: Harness?
    @State private var checkout = ""
    @State private var model = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Project header
                HStack(spacing: AmplinkSpacing.md) {
                    Image(systemName: "folder.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(AmplinkColors.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(projectName)
                            .font(AmplinkTypography.body(16, weight: .semibold))
                            .foregroundStyle(AmplinkColors.textPrimary)
                        Text(projectPath)
                            .font(AmplinkTypography.code(12))
                            .foregroundStyle(AmplinkColors.textMuted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer()
                }
                .padding(AmplinkSpacing.lg)
                .background(AmplinkColors.surfaceAdaptive)

                Divider().background(AmplinkColors.divider)

                ScrollView {
                    VStack(spacing: AmplinkSpacing.lg) {
                        // Harness selection
                        VStack(alignment: .leading, spacing: AmplinkSpacing.sm) {
                            Text("Harness")
                                .font(AmplinkTypography.caption(13, weight: .medium))
                                .foregroundStyle(AmplinkColors.textMuted)

                            ForEach(Harness.builtIn) { harness in
                                HarnessCard(
                                    harness: harness,
                                    isSelected: selectedHarness?.id == harness.id
                                ) {
                                    withAnimation(.easeInOut(duration: 0.15)) {
                                        selectedHarness = harness
                                    }
                                }
                            }
                        }

                        // Session config (visible when harness selected)
                        if selectedHarness != nil {
                            VStack(alignment: .leading, spacing: AmplinkSpacing.sm) {
                                Text("Configuration")
                                    .font(AmplinkTypography.caption(13, weight: .medium))
                                    .foregroundStyle(AmplinkColors.textMuted)

                                ConfigField(
                                    icon: "arrow.triangle.branch",
                                    placeholder: "Branch or checkout (default: current)",
                                    text: $checkout
                                )

                                ConfigField(
                                    icon: "cpu",
                                    placeholder: "Model override (default: agent's default)",
                                    text: $model
                                )
                            }
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                    .padding(AmplinkSpacing.lg)
                }

                // Launch button
                if let harness = selectedHarness {
                    VStack(spacing: 0) {
                        Divider().background(AmplinkColors.divider)
                        Button {
                            onSelect(harness)
                            dismiss()
                        } label: {
                            HStack(spacing: AmplinkSpacing.sm) {
                                Image(systemName: harness.icon)
                                    .font(.system(size: 14, weight: .semibold))
                                Text("Launch with \(harness.name)")
                                    .font(AmplinkTypography.body(15, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(harness.color)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .padding(AmplinkSpacing.lg)
                    }
                    .background(AmplinkColors.backgroundAdaptive)
                    .transition(.move(edge: .bottom))
                }
            }
            .background(AmplinkColors.backgroundAdaptive)
            .navigationTitle("Open Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .animation(.spring(response: 0.3, dampingFraction: 0.85), value: selectedHarness?.id)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Config Field

private struct ConfigField: View {
    let icon: String
    let placeholder: String
    @Binding var text: String

    var body: some View {
        HStack(spacing: AmplinkSpacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AmplinkColors.textMuted)
                .frame(width: 24)

            TextField(placeholder, text: $text)
                .font(AmplinkTypography.code(14))
                .foregroundStyle(AmplinkColors.textPrimary)
                .textFieldStyle(.plain)
        }
        .padding(AmplinkSpacing.md)
        .background(AmplinkColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(AmplinkColors.border, lineWidth: 0.5)
        )
    }
}

// MARK: - Harness Card

private struct HarnessCard: View {
    let harness: Harness
    var isSelected = false
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: AmplinkSpacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(harness.color.opacity(isSelected ? 0.2 : 0.12))
                        .frame(width: 44, height: 44)
                    Image(systemName: harness.icon)
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(harness.color)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(harness.name)
                        .font(AmplinkTypography.body(15, weight: .semibold))
                        .foregroundStyle(AmplinkColors.textPrimary)
                    Text(harness.description)
                        .font(AmplinkTypography.caption(13))
                        .foregroundStyle(AmplinkColors.textSecondary)
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(harness.color)
                }
            }
            .padding(AmplinkSpacing.md)
            .background(AmplinkColors.surfaceRaisedAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: AmplinkRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AmplinkRadius.md, style: .continuous)
                    .strokeBorder(isSelected ? harness.color.opacity(0.4) : AmplinkColors.border, lineWidth: isSelected ? 1.5 : 0.5)
            )
        }
        .buttonStyle(.plain)
    }
}

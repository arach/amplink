// OnboardingView — First-launch flow: value prop, permissions, model download.
//
// Three pages:
//   1. Welcome — what Amplink is, how to use it
//   2. Permissions — mic + speech recognition
//   3. Model — Parakeet download progress, Apple Speech fallback

import SwiftUI
import AVFoundation
import Speech

struct OnboardingView: View {
    @Binding var hasCompletedOnboarding: Bool
    @State private var page = 0

    var body: some View {
        TabView(selection: $page) {
            WelcomePage(onNext: { withAnimation { page = 1 } })
                .tag(0)
            ModelPage(onComplete: { withAnimation { page = 2 } })
                .tag(1)
            PermissionsPage(onNext: { hasCompletedOnboarding = true })
                .tag(2)
        }
        .tabViewStyle(.page(indexDisplayMode: .always))
        .indexViewStyle(.page(backgroundDisplayMode: .always))
        .background(AmplinkColors.backgroundAdaptive)
        .interactiveDismissDisabled()
    }
}

// MARK: - Page 1: Welcome

private struct WelcomePage: View {
    let onNext: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: AmplinkSpacing.xl) {
                // Icon
                ZStack {
                    Circle()
                        .fill(AmplinkColors.accent.opacity(0.1))
                        .frame(width: 100, height: 100)
                    Image(systemName: "rectangle.connected.to.line.below")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(AmplinkColors.accent)
                }

                VStack(spacing: AmplinkSpacing.md) {
                    Text("Amplink")
                        .font(AmplinkTypography.body(32, weight: .bold))
                        .foregroundStyle(AmplinkColors.textPrimary)

                    Text("Your AI coding sessions,\nright from your phone.")
                        .font(AmplinkTypography.body(17))
                        .foregroundStyle(AmplinkColors.textSecondary)
                        .multilineTextAlignment(.center)
                }

                // How it works
                VStack(alignment: .leading, spacing: AmplinkSpacing.md) {
                    FeatureRow(icon: "mic.fill", text: "Voice or text input")
                    FeatureRow(icon: "lock.shield", text: "End-to-end encrypted")
                    FeatureRow(icon: "bolt.fill", text: "On-device transcription")
                    FeatureRow(icon: "puzzlepiece.extension", text: "Works with any AI agent")
                }
                .padding(.top, AmplinkSpacing.lg)
            }

            Spacer()

            Button(action: onNext) {
                Text("Get Started")
                    .font(AmplinkTypography.body(17, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(AmplinkColors.accent)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .padding(.horizontal, AmplinkSpacing.xxl)
            .padding(.bottom, 60)
        }
    }
}

// MARK: - Page 2: Permissions

private struct PermissionsPage: View {
    let onNext: () -> Void

    @State private var micGranted: Bool?
    @State private var speechGranted: Bool?

    private var allGranted: Bool {
        micGranted == true && speechGranted == true
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: AmplinkSpacing.xl) {
                ZStack {
                    Circle()
                        .fill(AmplinkColors.accent.opacity(0.1))
                        .frame(width: 100, height: 100)
                    Image(systemName: "mic.badge.plus")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(AmplinkColors.accent)
                }

                VStack(spacing: AmplinkSpacing.md) {
                    Text("Permissions")
                        .font(AmplinkTypography.body(28, weight: .bold))
                        .foregroundStyle(AmplinkColors.textPrimary)

                    Text("Amplink needs microphone access for voice input and speech recognition for transcription.")
                        .font(AmplinkTypography.body(15))
                        .foregroundStyle(AmplinkColors.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, AmplinkSpacing.lg)
                }

                VStack(spacing: AmplinkSpacing.md) {
                    PermissionRow(
                        icon: "mic.fill",
                        title: "Microphone",
                        subtitle: "For voice recording",
                        granted: micGranted
                    ) {
                        await requestMic()
                    }

                    PermissionRow(
                        icon: "waveform",
                        title: "Speech Recognition",
                        subtitle: "For on-device transcription",
                        granted: speechGranted
                    ) {
                        await requestSpeech()
                    }
                }
                .padding(.horizontal, AmplinkSpacing.lg)
            }

            Spacer()

            Button(action: onNext) {
                Text(allGranted ? "Start Using Amplink" : "Skip for Now")
                    .font(AmplinkTypography.body(17, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(allGranted ? AmplinkColors.accent : AmplinkColors.surfaceAdaptive)
                    .foregroundStyle(allGranted ? .white : AmplinkColors.textSecondary)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(allGranted ? Color.clear : AmplinkColors.border, lineWidth: 0.5)
                    )
            }
            .padding(.horizontal, AmplinkSpacing.xxl)
            .padding(.bottom, 60)
        }
        .task {
            // Check existing status
            let micStatus = AVAudioApplication.shared.recordPermission
            micGranted = micStatus == .granted

            let speechStatus = SFSpeechRecognizer.authorizationStatus()
            speechGranted = speechStatus == .authorized
        }
    }

    private func requestMic() async {
        let granted = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
        micGranted = granted
    }

    private func requestSpeech() async {
        let granted = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
        speechGranted = granted
    }
}

// MARK: - Page 3: Model Download

private struct ModelPage: View {
    let onComplete: () -> Void

    #if canImport(FluidAudio)
    @ObservedObject private var parakeet = ParakeetModelManager.shared
    #endif

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: AmplinkSpacing.xl) {
                ZStack {
                    Circle()
                        .fill(AmplinkColors.statusActive.opacity(0.1))
                        .frame(width: 100, height: 100)
                    Image(systemName: "cpu")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(AmplinkColors.statusActive)
                }

                VStack(spacing: AmplinkSpacing.md) {
                    Text("Voice Engine")
                        .font(AmplinkTypography.body(28, weight: .bold))
                        .foregroundStyle(AmplinkColors.textPrimary)

                    Text("Amplink uses on-device AI for private speech-to-text. No data leaves your phone.")
                        .font(AmplinkTypography.body(15))
                        .foregroundStyle(AmplinkColors.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, AmplinkSpacing.lg)
                }

                VStack(spacing: AmplinkSpacing.md) {
                    // Apple Speech — always available
                    HStack(spacing: AmplinkSpacing.md) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(AmplinkColors.statusActive)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Apple Speech")
                                .font(AmplinkTypography.body(15, weight: .medium))
                                .foregroundStyle(AmplinkColors.textPrimary)
                            Text("Ready now — built into iOS")
                                .font(AmplinkTypography.caption(13))
                                .foregroundStyle(AmplinkColors.textSecondary)
                        }
                        Spacer()
                    }
                    .padding(AmplinkSpacing.md)
                    .background(AmplinkColors.surfaceAdaptive)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    // Parakeet — loading in background
                    #if canImport(FluidAudio)
                    HStack(spacing: AmplinkSpacing.md) {
                        parakeetIcon

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Parakeet AI")
                                .font(AmplinkTypography.body(15, weight: .medium))
                                .foregroundStyle(AmplinkColors.textPrimary)
                            Text(parakeetSubtitle)
                                .font(AmplinkTypography.caption(13))
                                .foregroundStyle(AmplinkColors.textSecondary)
                        }
                        Spacer()
                    }
                    .padding(AmplinkSpacing.md)
                    .background(AmplinkColors.surfaceAdaptive)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    #endif
                }
                .padding(.horizontal, AmplinkSpacing.lg)
            }

            Spacer()

            VStack(spacing: AmplinkSpacing.sm) {
                #if canImport(FluidAudio)
                if !parakeet.isReady {
                    Text("Parakeet is loading in the background. You can start using Amplink now.")
                        .font(AmplinkTypography.caption(13))
                        .foregroundStyle(AmplinkColors.textMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, AmplinkSpacing.xxl)
                }
                #endif

                Button(action: onComplete) {
                    Text("Continue")
                        .font(AmplinkTypography.body(17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(AmplinkColors.accent)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .padding(.horizontal, AmplinkSpacing.xxl)
            }
            .padding(.bottom, 60)
        }
    }

    #if canImport(FluidAudio)
    @ViewBuilder
    private var parakeetIcon: some View {
        switch parakeet.state {
        case .ready:
            Image(systemName: parakeet.isWarmedUp ? "checkmark.circle.fill" : "arrow.trianglehead.clockwise")
                .font(.system(size: 20))
                .foregroundStyle(parakeet.isWarmedUp ? AmplinkColors.statusActive : AmplinkColors.statusStreaming)
        case .downloading:
            ProgressView()
                .controlSize(.small)
        case .loading:
            ProgressView()
                .controlSize(.small)
        case .error:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(AmplinkColors.statusError)
        default:
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 20))
                .foregroundStyle(AmplinkColors.textMuted)
        }
    }

    private var parakeetSubtitle: String {
        switch parakeet.state {
        case .notDownloaded: "Waiting to download..."
        case .downloading(let p): "Downloading \(Int(p * 100))%..."
        case .downloaded: "Downloaded, loading..."
        case .loading: "Loading model..."
        case .ready: parakeet.isWarmedUp ? "Ready — on-device AI" : "Warming up..."
        case .error(let e): "Error: \(e)"
        }
    }
    #endif
}

// MARK: - Supporting Views

private struct FeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: AmplinkSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(AmplinkColors.accent)
                .frame(width: 28)
            Text(text)
                .font(AmplinkTypography.body(15))
                .foregroundStyle(AmplinkColors.textPrimary)
        }
    }
}

private struct PermissionRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let granted: Bool?
    let request: () async -> Void

    var body: some View {
        HStack(spacing: AmplinkSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(statusColor)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(AmplinkTypography.body(15, weight: .medium))
                    .foregroundStyle(AmplinkColors.textPrimary)
                Text(subtitle)
                    .font(AmplinkTypography.caption(13))
                    .foregroundStyle(AmplinkColors.textSecondary)
            }

            Spacer()

            if granted == true {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(AmplinkColors.statusActive)
            } else {
                Button("Allow") {
                    Task { await request() }
                }
                .font(AmplinkTypography.body(14, weight: .semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(AmplinkColors.accent)
                .foregroundStyle(.white)
                .clipShape(Capsule())
            }
        }
        .padding(AmplinkSpacing.md)
        .background(AmplinkColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var statusColor: Color {
        switch granted {
        case true: AmplinkColors.statusActive
        case false: AmplinkColors.statusError
        case nil: AmplinkColors.textMuted
        default: AmplinkColors.textMuted
        }
    }
}

import SwiftUI

public enum OpenClawMascotAccessory: Equatable, Sendable {
    case none
    case nightcap
    case gradCap
}

/// CypherClaw original artwork with uniform resizing only.
/// The existing type name and animator API remain compatible with native clients.
/// The artwork has no motion, tint, cutout or facial redraw.
public struct OpenClawMascotView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var animator: OpenClawMascotAnimator

    private let floats: Bool
    private let mood: OpenClawMascotMood
    private let accessory: OpenClawMascotAccessory
    private let interactive: Bool
    private let minimumFrameInterval: TimeInterval
    private let paused: Bool

    private var staticPose: OpenClawMascotPose {
        var pose = OpenClawMascotPose.staticPose(for: self.mood)
        // One hat at a time: the working static pose already wears the hard
        // hat, so a requested accessory stays off (mirrors the animator).
        if self.accessory != .none, pose.hardHat == 0 {
            pose.accessory = self.accessory
            pose.accessoryAmount = 1
        }
        return pose
    }

    /// - Parameters:
    ///   - floats: allow whole-body vertical travel (float loop, hops). Turn
    ///     off in tight layouts; bounces then show as squash-and-stretch only.
    ///   - mood: emotional state; transitions play an entrance gesture.
    ///   - accessory: optional headwear layered over the mood pose.
    ///   - interactive: enables click reactions and auto-sleep (waking takes
    ///     a click). Off by default so the mascot never swallows taps meant
    ///     for an enclosing control.
    ///   - minimumFrameInterval: minimum redraw interval for animated poses.
    ///   - paused: stops redrawing while the mascot is mounted but not shown,
    ///     such as in a hidden sidebar; SwiftUI cannot detect that on its own.
    public init(
        floats: Bool = true,
        mood: OpenClawMascotMood = .idle,
        accessory: OpenClawMascotAccessory = .none,
        interactive: Bool = false,
        minimumFrameInterval: TimeInterval = 1.0 / 30.0,
        paused: Bool = false)
    {
        self.floats = floats
        self.mood = mood
        self.accessory = accessory
        self.interactive = interactive
        self.minimumFrameInterval = minimumFrameInterval
        self.paused = paused
        self._animator = State(initialValue: OpenClawMascotAnimator(allowsAutoSleep: interactive))
    }

    public var body: some View {
        // The supplied artwork stays intact; compatibility parameters never redraw its face.
        OpenClawMascotCanvas(pose: self.staticPose, palette: .forScheme(self.colorScheme))
    }

    /// openclaw.ai hero drop-shadow color (`--logo-glow` / `--logo-glow-hover`).
    /// Pair with a shadow radius of ~10% of the mascot size (15% while hovering)
    /// to match the site's `drop-shadow(0 0 20px)` on a 100px mark.
    public static func heroGlowColor(for colorScheme: ColorScheme, hovering: Bool = false) -> Color {
        switch (colorScheme, hovering) {
        case (.light, false): Color(red: 239 / 255, green: 75 / 255, blue: 88 / 255).opacity(0.2)
        case (.light, true): Color(red: 0, green: 143 / 255, blue: 135 / 255).opacity(0.35)
        case (_, false): Color(red: 1, green: 77 / 255, blue: 77 / 255).opacity(0.4)
        case (_, true): Color(red: 0, green: 229 / 255, blue: 204 / 255).opacity(0.6)
        }
    }
}

extension View {
    /// Eye-tracking hover support where pointers exist; no-op elsewhere.
    @ViewBuilder
    fileprivate func pointerTracking(
        size: CGSize,
        onMove: @escaping (CGSize?) -> Void) -> some View
    {
        #if os(iOS) || os(macOS)
        self.onContinuousHover(coordinateSpace: .local) { phase in
            switch phase {
            case let .active(point):
                guard size.width > 0, size.height > 0 else { return }
                onMove(CGSize(
                    width: (point.x - size.width / 2) / (size.width / 2),
                    height: (point.y - size.height / 2) / (size.height / 2)))
            case .ended:
                onMove(nil)
            }
        }
        #else
        self
        #endif
    }
}

/// Body/antenna colors from the openclaw.ai theme variables: `:root` (dark)
/// and `html[data-theme='light']` in `Layout.astro`. Eye colors are fixed in
/// the site markup and shared by both themes.
struct OpenClawMascotPalette: Equatable {
    let gradientTop: Color
    let gradientBottom: Color
    let antenna: Color

    static let dark = OpenClawMascotPalette(
        gradientTop: Color(red: 1, green: 77 / 255, blue: 77 / 255),
        gradientBottom: Color(red: 153 / 255, green: 27 / 255, blue: 27 / 255),
        antenna: Color(red: 1, green: 77 / 255, blue: 77 / 255))

    static let light = OpenClawMascotPalette(
        gradientTop: Color(red: 255 / 255, green: 112 / 255, blue: 121 / 255),
        gradientBottom: Color(red: 234 / 255, green: 76 / 255, blue: 89 / 255),
        antenna: Color(red: 239 / 255, green: 75 / 255, blue: 88 / 255))

    static func forScheme(_ colorScheme: ColorScheme) -> OpenClawMascotPalette {
        colorScheme == .light ? .light : .dark
    }
}

/// Part transforms and expression channels for one animation frame, produced
/// by `OpenClawMascotAnimator` (or `staticPose` under Reduce Motion) and
/// consumed by `OpenClawMascotCanvas`.
struct OpenClawMascotPose: Equatable {
    var floatOffset: CGFloat = 0
    var antennaDegrees: CGFloat = 0
    /// 0..1: antennae fold outward and down (sadness, sneeze flop).
    var antennaDroop: CGFloat = 0
    var leftClawDegrees: CGFloat = 0
    var rightClawDegrees: CGFloat = 0
    var eyeGlowOpacity: CGFloat = 1
    var glowScale: CGFloat = 1
    var leftEyeOpenness: CGFloat = 1
    var rightEyeOpenness: CGFloat = 1
    /// 0..1: morph eyes into happy ∩ arcs.
    var happyEyes: CGFloat = 0
    /// Unit-ish look direction; drawn as a small eye/glow shift.
    var gaze: CGSize = .zero
    /// -1 frown … +1 smile.
    var mouthCurve: CGFloat = 0
    /// 0..1 open grin depth (takes over from `mouthCurve`).
    var mouthOpen: CGFloat = 0
    /// 0..1 surprised/yawning "o" (takes over from both mouth channels).
    var mouthRound: CGFloat = 0
    var blush: CGFloat = 0
    /// 0..1: hard hat drops from above until seated on the head.
    var hardHat: CGFloat = 0
    var accessory: OpenClawMascotAccessory = .none
    /// 0..1: requested headwear slides from above until seated.
    var accessoryAmount: CGFloat = 0
    /// Degrees around the canvas center.
    var bodyTilt: CGFloat = 0
    /// Vertical squash-and-stretch about the feet; x compensates slightly.
    var bodyStretch: CGFloat = 1
    /// 0..1: glow dots orbit instead of shining — too many clicks.
    var dizzy: CGFloat = 0
    var dizzyPhase: CGFloat = 0
    var effect: OpenClawMascotEffect = .none
    var effectPhase: CGFloat = 0

    /// Motionless expression per mood for Reduce Motion users.
    static func staticPose(for mood: OpenClawMascotMood) -> OpenClawMascotPose {
        var pose = OpenClawMascotPose()
        switch mood {
        case .idle, .curious, .attentive:
            break
        case .thinking:
            pose.gaze = CGSize(width: 0.3, height: -0.5)
        case .working:
            pose.hardHat = 1
            pose.rightClawDegrees = -28
            pose.gaze = CGSize(width: 0.4, height: 0.35)
            pose.mouthCurve = 0.15
            pose.bodyTilt = 2
        case .happy:
            pose.mouthCurve = 0.6
            pose.happyEyes = 0.4
        case .celebrating:
            pose.mouthCurve = 0.9
            pose.mouthOpen = 0.4
            pose.happyEyes = 0.8
            pose.leftClawDegrees = 30
            pose.rightClawDegrees = -30
        case .sad:
            pose.antennaDroop = 0.75
            pose.mouthCurve = -0.55
            pose.eyeGlowOpacity = 0.6
            pose.gaze = CGSize(width: 0, height: 0.5)
        case .sleepy:
            pose.leftEyeOpenness = 0.25
            pose.rightEyeOpenness = 0.25
            pose.eyeGlowOpacity = 0.5
            pose.antennaDroop = 0.35
            pose.accessory = .nightcap
            pose.accessoryAmount = 1
        }
        return pose
    }

    /// Keeps every channel inside the range the canvas can draw without
    /// clipping the 120x120 art box (claws touch x=0/120, antennae y~5).
    mutating func clampChannels() {
        self.floatOffset = self.floatOffset.clamped(to: -12...2)
        self.antennaDegrees = self.antennaDegrees.clamped(to: -14...14)
        self.antennaDroop = self.antennaDroop.clamped(to: 0...1)
        self.leftClawDegrees = self.leftClawDegrees.clamped(to: -45...45)
        self.rightClawDegrees = self.rightClawDegrees.clamped(to: -45...45)
        self.eyeGlowOpacity = self.eyeGlowOpacity.clamped(to: 0...1)
        self.glowScale = self.glowScale.clamped(to: 0.5...1.6)
        self.leftEyeOpenness = self.leftEyeOpenness.clamped(to: 0...1)
        self.rightEyeOpenness = self.rightEyeOpenness.clamped(to: 0...1)
        self.happyEyes = self.happyEyes.clamped(to: 0...1)
        self.gaze.width = self.gaze.width.clamped(to: -1.2...1.2)
        self.gaze.height = self.gaze.height.clamped(to: -1.2...1.2)
        self.mouthCurve = self.mouthCurve.clamped(to: -1...1)
        self.mouthOpen = self.mouthOpen.clamped(to: 0...1)
        self.mouthRound = self.mouthRound.clamped(to: 0...1)
        self.blush = self.blush.clamped(to: 0...1)
        self.hardHat = self.hardHat.clamped(to: 0...1)
        self.accessoryAmount = self.accessoryAmount.clamped(to: 0...1)
        self.bodyTilt = self.bodyTilt.clamped(to: -8...8)
        self.bodyStretch = self.bodyStretch.clamped(to: 0.86...1.05)
        self.dizzy = self.dizzy.clamped(to: 0...1)
    }
}

/// Displays the supplied original image with uniform resizing only.
struct OpenClawMascotCanvas: View {
    let pose: OpenClawMascotPose
    let palette: OpenClawMascotPalette
    static let hatAmber = Color(red: 0.95, green: 0.66, blue: 0.20)

    private var artwork: Image {
        #if SWIFT_PACKAGE
        Image(decorative: "CypherClawLogo", bundle: .module)
        #else
        Image(decorative: "CypherClawLogo")
        #endif
    }

    var body: some View {
        self.artwork
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .accessibilityHidden(true)
    }
}

import AppKit

@MainActor
enum CritterIconRenderer {
    private static let logoSize = NSSize(width: 18, height: 18)
    private static let badgeColumnWidth: CGFloat = 10
    private static let badgeSpacing: CGFloat = 2

    struct Badge {
        let symbolName: String
        let prominence: IconState.BadgeProminence
    }

    private struct Canvas {
        let h: CGFloat
        let snapX: (CGFloat) -> CGFloat
        let snapY: (CGFloat) -> CGFloat
        let context: CGContext
    }

    private static let artwork: NSImage? = {
        let bundle = Bundle.main.bundleURL.pathExtension == "app" ? Bundle.main : Bundle.module
        guard let url = bundle.url(forResource: "cypherclaw-logo", withExtension: "png") else { return nil }
        return NSImage(contentsOf: url)
    }()

    static func makeIcon(
        blink: CGFloat,
        legWiggle: CGFloat = 0,
        earWiggle: CGFloat = 0,
        earScale: CGFloat = 1,
        antennaDroop: CGFloat = 0,
        eyesClosedLines: Bool = false,
        happyEyes: Bool = false,
        badge: Badge? = nil) -> NSImage
    {
        let size = NSSize(
            width: self.logoSize.width + (badge == nil ? 0 : self.badgeSpacing + self.badgeColumnWidth),
            height: self.logoSize.height)
        guard let rep = self.makeBitmapRep(size: size) else {
            return NSImage(size: size)
        }
        rep.size = size

        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }

        guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
            return NSImage(size: size)
        }
        NSGraphicsContext.current = context
        context.imageInterpolation = .none
        context.cgContext.setShouldAntialias(true)
        context.cgContext.clear(CGRect(origin: .zero, size: size))

        let canvas = self.makeCanvas(for: rep, size: size, context: context)
        // Render the whole supplied logo in full color, using only the
        // user-authorized exterior transparency from the UI artwork resource.
        context.imageInterpolation = .high
        self.artwork?.draw(in: NSRect(origin: .zero, size: self.logoSize))

        if let badge {
            self.drawBadge(badge, canvas: canvas)
        }

        let image = NSImage(size: size)
        image.addRepresentation(rep)
        image.isTemplate = false
        return image
    }

    private static func makeBitmapRep(size: NSSize) -> NSBitmapImageRep? {
        // Keep the complete photo at 36×36px (18pt at 2×), with a separate
        // Retina backing region for any functional status badge.
        let pixelsWide = Int(size.width * 2)
        let pixelsHigh = Int(size.height * 2)
        return NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: pixelsWide,
            pixelsHigh: pixelsHigh,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bitmapFormat: [],
            bytesPerRow: 0,
            bitsPerPixel: 0)
    }

    private static func makeCanvas(
        for rep: NSBitmapImageRep,
        size: NSSize,
        context: NSGraphicsContext) -> Canvas
    {
        let stepX = size.width / max(CGFloat(rep.pixelsWide), 1)
        let stepY = size.height / max(CGFloat(rep.pixelsHigh), 1)
        let snapX: (CGFloat) -> CGFloat = { ($0 / stepX).rounded() * stepX }
        let snapY: (CGFloat) -> CGFloat = { ($0 / stepY).rounded() * stepY }

        let h = snapY(size.height)

        return Canvas(
            h: h,
            snapX: snapX,
            snapY: snapY,
            context: context.cgContext)
    }

    private static func drawBadge(_ badge: Badge, canvas: Canvas) {
        let strength: CGFloat = switch badge.prominence {
        case .primary: 1.0
        case .secondary: 0.58
        case .overridden: 0.85
        }

        // The activity puck occupies its own column beside the untouched photo.
        let diameter = canvas.snapX(self.logoSize.width * 0.46 * (0.92 + 0.08 * strength))
        let column = CGRect(
            x: self.logoSize.width + self.badgeSpacing,
            y: 0,
            width: self.badgeColumnWidth,
            height: canvas.h)
        let rect = CGRect(
            x: canvas.snapX(column.midX - diameter / 2),
            y: canvas.snapY(column.midY - diameter / 2),
            width: diameter,
            height: diameter)

        canvas.context.saveGState()
        canvas.context.setShouldAntialias(true)
        // Symbol knockout and antialiasing cannot write into the logo rectangle.
        canvas.context.clip(to: column)

        let fillAlpha: CGFloat = min(1.0, 0.36 + 0.24 * strength)
        let strokeAlpha: CGFloat = min(1.0, 0.78 + 0.22 * strength)

        canvas.context.setFillColor(NSColor.labelColor.withAlphaComponent(fillAlpha).cgColor)
        canvas.context.addEllipse(in: rect)
        canvas.context.fillPath()

        canvas.context.setStrokeColor(NSColor.labelColor.withAlphaComponent(strokeAlpha).cgColor)
        canvas.context.setLineWidth(max(1.25, canvas.snapX(self.logoSize.width * 0.075)))
        canvas.context.strokeEllipse(in: rect.insetBy(dx: 0.45, dy: 0.45))

        if let base = NSImage(systemSymbolName: badge.symbolName, accessibilityDescription: nil) {
            let pointSize = max(7.0, diameter * 0.82)
            let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .black)
            let symbol = base.withSymbolConfiguration(config) ?? base
            symbol.isTemplate = true

            let symbolRect = rect.insetBy(dx: diameter * 0.17, dy: diameter * 0.17)
            canvas.context.saveGState()
            canvas.context.setBlendMode(.clear)
            symbol.draw(
                in: symbolRect,
                from: .zero,
                operation: .sourceOver,
                fraction: 1,
                respectFlipped: true,
                hints: nil)
            canvas.context.restoreGState()
        }

        canvas.context.restoreGState()
    }
}

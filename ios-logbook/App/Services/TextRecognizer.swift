import ImageIO
import LogbookCore
import UIKit
import Vision

/// 아이패드 내장 Vision으로 글자 인식 (인터넷 불필요)
enum TextRecognizer {
    static func recognize(_ image: UIImage) async throws -> [OCRToken] {
        guard let cgImage = image.cgImage else { return [] }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)

        return try await Task.detached(priority: .userInitiated) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false   // 편명·시각은 단어가 아니므로 교정 끔
            request.recognitionLanguages = ["en-US"]
            request.minimumTextHeight = 0.01

            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation)
            try handler.perform([request])

            return (request.results ?? []).compactMap { obs -> OCRToken? in
                guard let best = obs.topCandidates(1).first else { return nil }
                let b = obs.boundingBox // 0~1, 왼쪽 아래 원점 → 왼쪽 위 원점으로 뒤집기
                return OCRToken(text: best.string, minX: b.minX, minY: 1 - b.maxY,
                                maxX: b.maxX, maxY: 1 - b.minY, confidence: Double(best.confidence))
            }
        }.value
    }
}

extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .upMirrored: self = .upMirrored
        case .down: self = .down
        case .downMirrored: self = .downMirrored
        case .left: self = .left
        case .leftMirrored: self = .leftMirrored
        case .right: self = .right
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}

enum ImageMetadata {
    /// 사진의 촬영 시각 (EXIF). 사진 보관함에서 고른 사진의 날짜 추정에 씀
    static func captureDate(from data: Data) -> Date? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any],
              let text = exif[kCGImagePropertyExifDateTimeOriginal] as? String else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        if let offset = exif[kCGImagePropertyExifOffsetTimeOriginal] as? String {
            f.dateFormat = "yyyy:MM:dd HH:mm:ssxxx"
            if let d = f.date(from: text + offset) { return d }
        }
        f.dateFormat = "yyyy:MM:dd HH:mm:ss"
        f.timeZone = .current
        return f.date(from: text)
    }
}

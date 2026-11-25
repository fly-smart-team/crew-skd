import Foundation
import LogbookCore
import UIKit

/// 이 비행에서 내가 한 이착륙 (회사 로그북 T/O, L/D 칸)
enum PilotRole: String, CaseIterable, Identifiable {
    case pf, pm, takeoffOnly, landingOnly
    var id: String { rawValue }
    var label: String {
        switch self {
        case .pf: return "PF (이륙·착륙)"
        case .pm: return "PM"
        case .takeoffOnly: return "이륙만"
        case .landingOnly: return "착륙만"
        }
    }
    var takeoff: Bool { self == .pf || self == .takeoffOnly }
    var landing: Bool { self == .pf || self == .landingOnly }

    init(takeoffs: Int, landings: Int) {
        switch (takeoffs > 0, landings > 0) {
        case (true, true): self = .pf
        case (true, false): self = .takeoffOnly
        case (false, true): self = .landingOnly
        case (false, false): self = .pm
        }
    }
}

/// 편집 화면이 다루는 값 묶음 (저장 전 상태)
struct EntryDraft {
    var record: LogEntryRecord
    /// 새 기록은 nil로 시작해서 꼭 고르게 함 (90일 이착륙 계산이 틀어지지 않도록)
    var role: PilotRole?
    var nightManual = false
    var instrumentManual = false
    var notes: [ScanNote] = []
    var imageData: Data?
    var isOOOIPage = true

    static func new(settings: SettingsStore, last: FlightEntry?) -> EntryDraft {
        var r = LogEntryRecord(aircraftType: last?.aircraftType ?? settings.defaultAircraftType,
                               registration: last?.registration ?? "",
                               duty: settings.defaultDuty)
        r.logDate = LogDate.string(for: Date(), in: settings.logTimeZone)
        return EntryDraft(record: r, role: nil)
    }

    static func editing(_ e: FlightEntry) -> EntryDraft {
        EntryDraft(record: e.record, role: PilotRole(takeoffs: e.takeoffs, landings: e.landings),
                   nightManual: e.nightManual, instrumentManual: e.instrumentManual, imageData: e.scanImage)
    }
}

enum ScanPipeline {
    /// 사진 → OCR → OOOI 해석 → 날짜 붙이기 → 편집용 초안
    static func run(image: UIImage, captureDate: Date?, settings: SettingsStore,
                    airports: AirportDatabase, last: FlightEntry?) async throws -> EntryDraft {
        let tokens = try await TextRecognizer.recognize(image)
        let reading = OOOIScreenParser(airports: airports).parse(tokens)
        let reference = OOOITimeResolver.referenceDate(for: reading, fallback: captureDate ?? Date())
        let times = OOOITimeResolver.resolve(reading, reference: reference)

        var draft = EntryDraft.new(settings: settings, last: last)
        draft.isOOOIPage = reading.isOOOIPage
        draft.notes = reading.notes
        draft.record.source = "scan"
        draft.record.flightNumber = reading.flightID ?? ""
        draft.record.originICAO = reading.originICAO ?? ""
        draft.record.destinationICAO = reading.destinationICAO ?? ""
        draft.record.outUTC = times.out
        draft.record.offUTC = times.off
        draft.record.onUTC = times.on
        draft.record.inUTC = times.inTime
        FlightCalculator.recalculate(&draft.record, airports: airports, options: settings.calcOptions)
        draft.imageData = image.resized(maxSide: 1600).jpegData(compressionQuality: 0.6)
        return draft
    }
}

extension UIImage {
    func resized(maxSide: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let scale = maxSide / longest
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}

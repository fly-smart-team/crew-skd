import Foundation

/// 로그북 한 줄. 회사 Flight Log의 칸을 그대로 따릅니다.
///
/// | 회사 칸 | 필드 |
/// |---|---|
/// | Date | `logDate` (기준 시간대의 출발 날짜) |
/// | A/C, HL | `aircraftType`, `registration` |
/// | FLT NO, Route | `flightNumber`, `originICAO`/`destinationICAO` |
/// | IRR, Duty | `irregular`, `duty` (C=기장, F=부기장 …) |
/// | R/O, R/I | `outUTC`, `inUTC` |
/// | Duty time | `blockMinutes` (R/I − R/O) |
/// | T/S | `flightMinutes` (ON − OFF) |
/// | N/T, I/T | `nightMinutes`, `instrumentMinutes` |
/// | T/O, L/D | `takeoffs`, `landings` (본인이 했으면 1) |
public struct LogEntryRecord: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var logDate: String
    public var aircraftType: String
    public var registration: String
    public var flightNumber: String
    public var originICAO: String
    public var destinationICAO: String
    public var irregular: String
    public var duty: String
    public var outUTC: Date?
    public var offUTC: Date?
    public var onUTC: Date?
    public var inUTC: Date?
    public var blockMinutes: Int
    public var flightMinutes: Int
    public var nightMinutes: Int
    public var instrumentMinutes: Int
    public var takeoffs: Int
    public var landings: Int
    public var nightTakeoffs: Int
    public var nightLandings: Int
    public var isSimulator: Bool
    public var remarks: String
    public var source: String
    public var createdAt: Date
    public var updatedAt: Date

    public init(id: UUID = UUID(), logDate: String = "", aircraftType: String = "", registration: String = "",
                flightNumber: String = "", originICAO: String = "", destinationICAO: String = "",
                irregular: String = "", duty: String = "C",
                outUTC: Date? = nil, offUTC: Date? = nil, onUTC: Date? = nil, inUTC: Date? = nil,
                blockMinutes: Int = 0, flightMinutes: Int = 0, nightMinutes: Int = 0, instrumentMinutes: Int = 0,
                takeoffs: Int = 0, landings: Int = 0, nightTakeoffs: Int = 0, nightLandings: Int = 0,
                isSimulator: Bool = false, remarks: String = "", source: String = "manual",
                createdAt: Date = Date(), updatedAt: Date = Date()) {
        self.id = id
        self.logDate = logDate
        self.aircraftType = aircraftType
        self.registration = registration
        self.flightNumber = flightNumber
        self.originICAO = originICAO
        self.destinationICAO = destinationICAO
        self.irregular = irregular
        self.duty = duty
        self.outUTC = outUTC
        self.offUTC = offUTC
        self.onUTC = onUTC
        self.inUTC = inUTC
        self.blockMinutes = blockMinutes
        self.flightMinutes = flightMinutes
        self.nightMinutes = nightMinutes
        self.instrumentMinutes = instrumentMinutes
        self.takeoffs = takeoffs
        self.landings = landings
        self.nightTakeoffs = nightTakeoffs
        self.nightLandings = nightLandings
        self.isSimulator = isSimulator
        self.remarks = remarks
        self.source = source
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// 기장(PIC) 시간으로 셀지
    public var isPIC: Bool { duty == "C" }

    /// 90일 계산 등에 쓰는 기준 시점
    public var eventDate: Date { outUTC ?? LogDate.date(from: logDate) ?? createdAt }
}

public enum Duty: String, CaseIterable, Sendable {
    case captain = "C", firstOfficer = "F", instructor = "I", observer = "O"

    public var label: String {
        switch self {
        case .captain: return "C · 기장"
        case .firstOfficer: return "F · 부기장"
        case .instructor: return "I · 교관"
        case .observer: return "O · 옵저버"
        }
    }
}

public enum InstrumentRule: String, Codable, CaseIterable, Sendable {
    case manual, flightTime, blockTime

    public var label: String {
        switch self {
        case .manual: return "직접 입력"
        case .flightTime: return "비행시간(OFF→ON)과 같게"
        case .blockTime: return "블록시간(OUT→IN)과 같게"
        }
    }
}

public struct FlightCalcOptions {
    public var nightDefinition: NightDefinition
    public var instrumentRule: InstrumentRule
    /// 로그북 날짜를 정하는 시간대 (회사 로그북은 한국 날짜)
    public var logDateTimeZone: TimeZone

    public init(nightDefinition: NightDefinition = .civilTwilight, instrumentRule: InstrumentRule = .flightTime,
                logDateTimeZone: TimeZone = TimeZone(identifier: "Asia/Seoul")!) {
        self.nightDefinition = nightDefinition
        self.instrumentRule = instrumentRule
        self.logDateTimeZone = logDateTimeZone
    }
}

public enum FlightCalculator {
    /// OUT/OFF/ON/IN과 공항으로 블록·비행·야간·계기 시간과 로그 날짜를 다시 계산.
    /// `pilotFlying`이면 이착륙 1회와 주/야간 구분을 채웁니다.
    /// `keepNight`/`keepInstrument`가 true면 직접 고친 값을 유지합니다.
    public static func recalculate(_ r: inout LogEntryRecord, airports: AirportDatabase, options: FlightCalcOptions,
                                   pilotFlying: Bool?, keepNight: Bool = false, keepInstrument: Bool = false) {
        recalculate(&r, airports: airports, options: options, takeoff: pilotFlying, landing: pilotFlying,
                    keepNight: keepNight, keepInstrument: keepInstrument)
    }

    /// 이륙·착륙을 따로 지정하는 버전 (예: 이륙은 내가, 착륙은 상대가). nil이면 기존 값 유지.
    public static func recalculate(_ r: inout LogEntryRecord, airports: AirportDatabase, options: FlightCalcOptions,
                                   takeoff: Bool? = nil, landing: Bool? = nil,
                                   keepNight: Bool = false, keepInstrument: Bool = false) {
        guard !r.isSimulator else { return }
        if let out = r.outUTC {
            r.logDate = LogDate.string(for: out, in: options.logDateTimeZone)
        }
        if let out = r.outUTC, let inn = r.inUTC {
            r.blockMinutes = max(0, Int((inn.timeIntervalSince(out) / 60).rounded()))
        }
        if let off = r.offUTC, let on = r.onUTC {
            r.flightMinutes = max(0, Int((on.timeIntervalSince(off) / 60).rounded()))
        }

        var night: NightResult?
        if let out = r.outUTC, let inn = r.inUTC,
           let o = airports.airport(r.originICAO), let d = airports.airport(r.destinationICAO) {
            night = NightTimeCalculator.compute(out: out, off: r.offUTC, on: r.onUTC, inTime: inn,
                                                origin: o, destination: d, definition: options.nightDefinition)
        }
        if let night, !keepNight { r.nightMinutes = night.nightMinutes }

        if !keepInstrument {
            switch options.instrumentRule {
            case .manual: break
            case .flightTime: r.instrumentMinutes = r.flightMinutes
            case .blockTime: r.instrumentMinutes = r.blockMinutes
            }
        }

        if let to = takeoff {
            r.takeoffs = to ? 1 : 0
            r.nightTakeoffs = to && (night?.takeoffAtNight ?? false) ? 1 : 0
        }
        if let ld = landing {
            r.landings = ld ? 1 : 0
            r.nightLandings = ld && (night?.landingAtNight ?? false) ? 1 : 0
        }
    }
}

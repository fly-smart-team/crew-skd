import Foundation

/// 앱 쓰기 전까지의 누계 (회사 Flight Summary 숫자를 옮겨 적는 칸)
public struct CarryForward: Codable, Hashable, Sendable {
    public var totalMinutes: Int
    public var picMinutes: Int
    public var nightMinutes: Int
    public var instrumentMinutes: Int
    /// 이 날짜까지의 누계 (이 날짜 이후 기록만 더함). "yyyy-MM-dd", 비우면 전부 더함
    public var asOfDate: String

    public init(totalMinutes: Int = 0, picMinutes: Int = 0, nightMinutes: Int = 0,
                instrumentMinutes: Int = 0, asOfDate: String = "") {
        self.totalMinutes = totalMinutes
        self.picMinutes = picMinutes
        self.nightMinutes = nightMinutes
        self.instrumentMinutes = instrumentMinutes
        self.asOfDate = asOfDate
    }
}

public struct LogTotals: Equatable, Sendable {
    public var flights = 0
    public var totalMinutes = 0
    public var picMinutes = 0
    public var nightMinutes = 0
    public var instrumentMinutes = 0
    public var takeoffs = 0
    public var landings = 0
    public var simSessions = 0

    public init() {}

    /// 실제 비행 기록 합계. carry가 있으면 그 날짜 **이후** 기록만 더하고 누계를 얹습니다.
    public static func compute(_ records: [LogEntryRecord], carry: CarryForward? = nil,
                               from: String? = nil, through: String? = nil) -> LogTotals {
        var t = LogTotals()
        if let c = carry, from == nil {
            t.totalMinutes = c.totalMinutes
            t.picMinutes = c.picMinutes
            t.nightMinutes = c.nightMinutes
            t.instrumentMinutes = c.instrumentMinutes
        }
        for r in records {
            if let c = carry, from == nil, !c.asOfDate.isEmpty, r.logDate <= c.asOfDate { continue }
            if let from, r.logDate < from { continue }
            if let through, r.logDate > through { continue }
            if r.isSimulator { t.simSessions += 1; continue }
            t.flights += 1
            t.totalMinutes += r.blockMinutes
            if r.isPIC { t.picMinutes += r.blockMinutes }
            t.nightMinutes += r.nightMinutes
            t.instrumentMinutes += r.instrumentMinutes
            t.takeoffs += r.takeoffs
            t.landings += r.landings
        }
        return t
    }
}

/// 최근 90일 이착륙 (회사 로그북 "Recent 90 days" 표와 같은 구성)
public struct RecencyStatus: Equatable, Sendable {
    public var flightTakeoffs = 0
    public var flightLandings = 0
    public var simTakeoffs = 0
    public var simLandings = 0
    public var nightTakeoffs = 0
    public var nightLandings = 0
    public var required = 3
    /// 지금 기록 기준으로 요건이 유지되는 마지막 날
    public var validUntil: Date?

    public var totalTakeoffs: Int { flightTakeoffs + simTakeoffs }
    public var totalLandings: Int { flightLandings + simLandings }
    public var isCurrent: Bool { totalTakeoffs >= required && totalLandings >= required }
}

public enum RecencyCalculator {
    public static func status(_ records: [LogEntryRecord], asOf: Date, windowDays: Int = 90,
                              required: Int = 3) -> RecencyStatus {
        var s = RecencyStatus()
        s.required = required
        let window = TimeInterval(windowDays) * 86_400
        let start = asOf.addingTimeInterval(-window)
        var toDates: [Date] = [], ldDates: [Date] = []

        for r in records {
            let d = r.eventDate
            guard d > start, d <= asOf else { continue }
            if r.isSimulator {
                s.simTakeoffs += r.takeoffs
                s.simLandings += r.landings
            } else {
                s.flightTakeoffs += r.takeoffs
                s.flightLandings += r.landings
                s.nightTakeoffs += r.nightTakeoffs
                s.nightLandings += r.nightLandings
            }
            toDates += Array(repeating: d, count: max(0, r.takeoffs))
            ldDates += Array(repeating: d, count: max(0, r.landings))
        }
        toDates.sort(by: >)
        ldDates.sort(by: >)
        if toDates.count >= required, ldDates.count >= required {
            let limiting = min(toDates[required - 1], ldDates[required - 1])
            s.validUntil = limiting.addingTimeInterval(window)
        }
        return s
    }
}

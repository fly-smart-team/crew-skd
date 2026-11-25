import Foundation

/// 하루 안의 시각 (UTC 기준 HHMM). MCDU의 `2319Z` 같은 값.
public struct ClockTime: Hashable, Codable, Sendable, CustomStringConvertible {
    public let hour: Int
    public let minute: Int

    public init?(hour: Int, minute: Int) {
        guard (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        self.hour = hour
        self.minute = minute
    }

    public init(minutesOfDay m: Int) {
        let v = ((m % 1440) + 1440) % 1440
        self.hour = v / 60
        self.minute = v % 60
    }

    /// "2319" → 23:19
    public init?(digits: String) {
        guard digits.count == 4, digits.allSatisfy({ $0.isASCII && $0.isNumber }),
              let h = Int(digits.prefix(2)), let m = Int(digits.suffix(2)) else { return nil }
        self.init(hour: h, minute: m)
    }

    public var minutesOfDay: Int { hour * 60 + minute }

    /// "2319"
    public var description: String { TimeText.pad2(hour) + TimeText.pad2(minute) }

    /// start → end 까지 걸린 분 (자정 넘김 처리)
    public static func minutes(from start: ClockTime, to end: ClockTime) -> Int {
        ((end.minutesOfDay - start.minutesOfDay) % 1440 + 1440) % 1440
    }

    public func adding(minutes: Int) -> ClockTime { ClockTime(minutesOfDay: minutesOfDay + minutes) }
}

public enum TimeText {
    static func pad2(_ v: Int) -> String { v < 10 ? "0\(v)" : "\(v)" }

    /// 345 → "5:45"
    public static func hmm(_ minutes: Int) -> String {
        let m = max(0, minutes)
        return "\(m / 60):\(pad2(m % 60))"
    }

    /// "5:45", "05:45", "0545", "545" → 345
    public static func parseHMM(_ text: String) -> Int? {
        let s = text.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return nil }
        if let colon = s.firstIndex(of: ":") {
            guard let h = Int(s[..<colon]), let m = Int(s[s.index(after: colon)...]),
                  h >= 0, (0..<60).contains(m) else { return nil }
            return h * 60 + m
        }
        guard s.allSatisfy({ $0.isASCII && $0.isNumber }), s.count >= 3, s.count <= 4,
              let v = Int(s) else { return nil }
        let h = v / 100, m = v % 100
        guard m < 60 else { return nil }
        return h * 60 + m
    }

    static let utc = TimeZone(identifier: "UTC")!

    /// UTC 시각을 "MM/dd HH:mm" (회사 로그북 R/O·R/I 형식)
    public static func companyStamp(_ date: Date) -> String {
        let c = utcCalendar.dateComponents([.month, .day, .hour, .minute], from: date)
        return "\(pad2(c.month!))/\(pad2(c.day!)) \(pad2(c.hour!)):\(pad2(c.minute!))"
    }

    /// UTC 시각을 "HHmm"
    public static func zulu(_ date: Date) -> String {
        let c = utcCalendar.dateComponents([.hour, .minute], from: date)
        return pad2(c.hour!) + pad2(c.minute!)
    }

    public static var utcCalendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = utc
        return cal
    }
}

/// 로그북 날짜(현지 날짜) 문자열 "yyyy-MM-dd"
public enum LogDate {
    public static func string(for date: Date, in timeZone: TimeZone) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return "\(c.year!)-\(TimeText.pad2(c.month!))-\(TimeText.pad2(c.day!))"
    }

    /// "2026-11-25" → 그 날짜 정오(해당 시간대). 정렬·90일 계산용.
    public static func date(from string: String, in timeZone: TimeZone = TimeZone(identifier: "Asia/Seoul")!) -> Date? {
        let parts = string.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        return cal.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /// "2026-11-25" → "2026/11/25" (회사 로그북 표기)
    public static func companyStyle(_ string: String) -> String {
        string.replacingOccurrences(of: "-", with: "/")
    }
}

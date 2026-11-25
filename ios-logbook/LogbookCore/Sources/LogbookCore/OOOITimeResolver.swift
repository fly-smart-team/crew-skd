import Foundation

public struct ResolvedOOOI: Equatable, Sendable {
    public var out: Date?
    public var off: Date?
    public var on: Date?
    public var inTime: Date?
}

/// HHMM만 있는 OOOI 시각에 날짜를 붙입니다.
///
/// MCDU의 DATE는 **사진 찍을 때의 UTC 날짜**이지 OUT 날짜가 아닙니다.
/// 그래서 가장 마지막 시각(IN)을 "기준 시각 이전의 가장 가까운 시점"으로 두고,
/// 거꾸로 ON → OFF → OUT 순서로 "바로 다음 시각 이전의 가장 가까운 시점"을 찾습니다.
/// 예) 화면 25NOV 0509Z, OUT 2319Z, IN 0504Z → OUT은 24일 23:19Z, IN은 25일 05:04Z
public enum OOOITimeResolver {
    /// 화면의 DATE/UTC로 기준 시각을 만들고, 없으면 fallback(사진 촬영 시각 또는 지금)을 씀
    public static func referenceDate(for reading: OOOIScreenReading, fallback: Date) -> Date {
        let cal = TimeText.utcCalendar
        guard let day = reading.screenDay, let month = reading.screenMonth else { return fallback }

        // 연도가 잘렸으면 fallback과 가장 가까운 해를 고름
        let fy = cal.component(.year, from: fallback)
        let years = reading.screenYear.map { [$0] } ?? [fy - 1, fy, fy + 1]
        let time = reading.screenUTC
        let candidates = years.compactMap { y -> Date? in
            cal.date(from: DateComponents(year: y, month: month, day: day,
                                          hour: time?.hour ?? 23, minute: time?.minute ?? 59))
        }
        return candidates.min { abs($0.timeIntervalSince(fallback)) < abs($1.timeIntervalSince(fallback)) } ?? fallback
    }

    public static func resolve(_ reading: OOOIScreenReading, reference: Date) -> ResolvedOOOI {
        resolve(out: reading.out, off: reading.off, on: reading.on, inTime: reading.inTime, reference: reference)
    }

    public static func resolve(out: ClockTime?, off: ClockTime?, on: ClockTime?, inTime: ClockTime?,
                               reference: Date) -> ResolvedOOOI {
        var bound = reference
        var result: [Date?] = []
        for t in [inTime, on, off, out] {
            guard let t else { result.append(nil); continue }
            let d = latest(t, notAfter: bound)
            result.append(d)
            bound = d
        }
        return ResolvedOOOI(out: result[3], off: result[2], on: result[1], inTime: result[0])
    }

    /// bound 이전(같아도 됨)에서 가장 늦은, 시각이 t인 순간
    static func latest(_ t: ClockTime, notAfter bound: Date) -> Date {
        let cal = TimeText.utcCalendar
        let startOfDay = cal.startOfDay(for: bound)
        let sameDay = startOfDay.addingTimeInterval(TimeInterval(t.minutesOfDay * 60))
        return sameDay <= bound ? sameDay : sameDay.addingTimeInterval(-86_400)
    }
}

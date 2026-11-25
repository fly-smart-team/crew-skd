import Foundation

public enum NightDefinition: String, Codable, CaseIterable, Sendable {
    /// 시민박명 기준: 태양 고도 −6° 미만 (ICAO 정의)
    case civilTwilight
    /// 일몰~일출: 태양 고도 −0.833° 미만
    case sunsetToSunrise

    public var sunAltitudeThreshold: Double {
        switch self {
        case .civilTwilight: return -6
        case .sunsetToSunrise: return -0.833
        }
    }

    public var label: String {
        switch self {
        case .civilTwilight: return "시민박명 (태양 고도 −6°)"
        case .sunsetToSunrise: return "일몰 ~ 일출"
        }
    }
}

/// NOAA 태양 위치 계산식 (오차 1분 이내 수준)
public enum SolarCalculator {
    /// 해당 시각·위치의 태양 고도(도)
    public static func elevation(at date: Date, latitude: Double, longitude: Double) -> Double {
        let rad = Double.pi / 180
        let jd = date.timeIntervalSince1970 / 86_400 + 2_440_587.5
        let t = (jd - 2_451_545) / 36_525

        let l0 = (280.46646 + t * (36_000.76983 + t * 0.0003032)).truncatingRemainder(dividingBy: 360)
        let m = 357.52911 + t * (35_999.05029 - 0.0001537 * t)
        let e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
        let c = sin(m * rad) * (1.914602 - t * (0.004817 + 0.000014 * t))
            + sin(2 * m * rad) * (0.019993 - 0.000101 * t)
            + sin(3 * m * rad) * 0.000289
        let trueLong = l0 + c
        let omega = 125.04 - 1934.136 * t
        let lambda = trueLong - 0.00569 - 0.00478 * sin(omega * rad)
        let eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
        let eps = eps0 + 0.00256 * cos(omega * rad)
        let decl = asin(sin(eps * rad) * sin(lambda * rad))

        let y = pow(tan(eps * rad / 2), 2)
        let eqTime = 4 / rad * (y * sin(2 * l0 * rad) - 2 * e * sin(m * rad)
            + 4 * e * y * sin(m * rad) * cos(2 * l0 * rad)
            - 0.5 * y * y * sin(4 * l0 * rad) - 1.25 * e * e * sin(2 * m * rad))

        let secondsOfDay = date.timeIntervalSince1970.truncatingRemainder(dividingBy: 86_400)
        let utcMinutes = (secondsOfDay < 0 ? secondsOfDay + 86_400 : secondsOfDay) / 60
        var trueSolar = (utcMinutes + eqTime + 4 * longitude).truncatingRemainder(dividingBy: 1440)
        if trueSolar < 0 { trueSolar += 1440 }
        let hourAngle = trueSolar / 4 - 180

        let cosZenith = sin(latitude * rad) * sin(decl) + cos(latitude * rad) * cos(decl) * cos(hourAngle * rad)
        return 90 - acos(min(1, max(-1, cosZenith))) / rad
    }

    public static func isNight(at date: Date, latitude: Double, longitude: Double,
                               definition: NightDefinition) -> Bool {
        elevation(at: date, latitude: latitude, longitude: longitude) < definition.sunAltitudeThreshold
    }
}

public struct NightResult: Equatable, Sendable {
    public var nightMinutes: Int
    public var takeoffAtNight: Bool
    public var landingAtNight: Bool
}

/// 블록 시간(OUT→IN) 중 야간인 분을 셉니다.
/// OFF 전에는 출발 공항, ON 뒤에는 도착 공항, 그 사이는 대권 항로상의 위치로 판단합니다.
public enum NightTimeCalculator {
    public static func compute(out: Date, off: Date?, on: Date?, inTime: Date,
                               origin: Airport, destination: Airport,
                               definition: NightDefinition) -> NightResult {
        let off = off ?? out
        let on = on ?? inTime
        let total = Int((inTime.timeIntervalSince(out) / 60).rounded())
        var night = 0
        if total > 0 {
            for i in 0..<total {
                let t = out.addingTimeInterval(Double(i) * 60 + 30) // 각 분의 가운데
                let p = position(at: t, off: off, on: on, origin: origin, destination: destination)
                if SolarCalculator.isNight(at: t, latitude: p.0, longitude: p.1, definition: definition) { night += 1 }
            }
        }
        return NightResult(
            nightMinutes: night,
            takeoffAtNight: SolarCalculator.isNight(at: off, latitude: origin.latitude, longitude: origin.longitude, definition: definition),
            landingAtNight: SolarCalculator.isNight(at: on, latitude: destination.latitude, longitude: destination.longitude, definition: definition)
        )
    }

    static func position(at t: Date, off: Date, on: Date, origin: Airport, destination: Airport) -> (Double, Double) {
        if t <= off { return (origin.latitude, origin.longitude) }
        if t >= on { return (destination.latitude, destination.longitude) }
        let f = t.timeIntervalSince(off) / on.timeIntervalSince(off)
        return greatCircle(from: (origin.latitude, origin.longitude), to: (destination.latitude, destination.longitude), fraction: f)
    }

    static func greatCircle(from a: (Double, Double), to b: (Double, Double), fraction f: Double) -> (Double, Double) {
        let rad = Double.pi / 180
        let (lat1, lon1, lat2, lon2) = (a.0 * rad, a.1 * rad, b.0 * rad, b.1 * rad)
        let d = acos(min(1, max(-1, sin(lat1) * sin(lat2) + cos(lat1) * cos(lat2) * cos(lon2 - lon1))))
        if d < 1e-9 { return a }
        let A = sin((1 - f) * d) / sin(d), B = sin(f * d) / sin(d)
        let x = A * cos(lat1) * cos(lon1) + B * cos(lat2) * cos(lon2)
        let y = A * cos(lat1) * sin(lon1) + B * cos(lat2) * sin(lon2)
        let z = A * sin(lat1) + B * sin(lat2)
        return (atan2(z, sqrt(x * x + y * y)) / rad, atan2(y, x) / rad)
    }
}

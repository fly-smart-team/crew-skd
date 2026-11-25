import Foundation

public struct Airport: Hashable, Codable, Sendable {
    public var icao: String
    public var iata: String
    public var latitude: Double
    public var longitude: Double
    public var timeZoneID: String

    public init(icao: String, iata: String, latitude: Double, longitude: Double, timeZoneID: String) {
        self.icao = icao.uppercased()
        self.iata = iata.uppercased()
        self.latitude = latitude
        self.longitude = longitude
        self.timeZoneID = timeZoneID
    }

    public var timeZone: TimeZone { TimeZone(identifier: timeZoneID) ?? TimeZone(identifier: "UTC")! }
}

/// 공항 정보 (ICAO ↔ IATA, 좌표, 시간대). 야간 시간 계산과 노선 표기에 씁니다.
/// 기본 목록에 없는 공항은 앱의 설정 화면에서 추가할 수 있습니다.
public struct AirportDatabase: Sendable {
    private var byICAO: [String: Airport] = [:]
    private var byIATA: [String: Airport] = [:]

    public init(_ airports: [Airport]) {
        for a in airports { add(a) }
    }

    public mutating func add(_ a: Airport) {
        byICAO[a.icao] = a
        if !a.iata.isEmpty { byIATA[a.iata] = a }
    }

    public func adding(_ extra: [Airport]) -> AirportDatabase {
        var copy = self
        for a in extra { copy.add(a) }
        return copy
    }

    /// ICAO(4자) 또는 IATA(3자) 어느 쪽이든 찾기
    public func airport(_ code: String) -> Airport? {
        let c = code.uppercased().trimmingCharacters(in: .whitespaces)
        return byICAO[c] ?? byIATA[c]
    }

    /// 앞부분만 읽힌 ICAO 코드(예: "VVT")로 후보 찾기
    public func icaoCandidates(prefix: String) -> [Airport] {
        let p = prefix.uppercased()
        guard !p.isEmpty else { return [] }
        return byICAO.values.filter { $0.icao.hasPrefix(p) }.sorted { $0.icao < $1.icao }
    }

    /// 노선 표기용 코드 (IATA가 있으면 IATA)
    public func displayCode(_ icao: String) -> String {
        airport(icao).map { $0.iata.isEmpty ? $0.icao : $0.iata } ?? icao
    }

    public var all: [Airport] { byICAO.values.sorted { $0.icao < $1.icao } }

    public static let standard = AirportDatabase(standardAirports)
}

private let KST = "Asia/Seoul", JST = "Asia/Tokyo", CST = "Asia/Shanghai"

// 좌표는 야간 계산용이라 소수 둘째 자리 정도면 충분합니다.
private let standardAirports: [Airport] = [
    // 한국
    Airport(icao: "RKSI", iata: "ICN", latitude: 37.4602, longitude: 126.4407, timeZoneID: KST),
    Airport(icao: "RKSS", iata: "GMP", latitude: 37.5583, longitude: 126.7906, timeZoneID: KST),
    Airport(icao: "RKPC", iata: "CJU", latitude: 33.5113, longitude: 126.4930, timeZoneID: KST),
    Airport(icao: "RKPK", iata: "PUS", latitude: 35.1795, longitude: 128.9382, timeZoneID: KST),
    Airport(icao: "RKJJ", iata: "KWJ", latitude: 35.1264, longitude: 126.8089, timeZoneID: KST),
    Airport(icao: "RKTU", iata: "CJJ", latitude: 36.7166, longitude: 127.4991, timeZoneID: KST),
    Airport(icao: "RKTN", iata: "TAE", latitude: 35.8941, longitude: 128.6589, timeZoneID: KST),
    Airport(icao: "RKPU", iata: "USN", latitude: 35.5935, longitude: 129.3518, timeZoneID: KST),
    Airport(icao: "RKJY", iata: "RSU", latitude: 34.8423, longitude: 127.6169, timeZoneID: KST),
    Airport(icao: "RKJB", iata: "MWX", latitude: 34.9914, longitude: 126.3828, timeZoneID: KST),
    Airport(icao: "RKNY", iata: "YNY", latitude: 38.0613, longitude: 128.6692, timeZoneID: KST),
    Airport(icao: "RKTH", iata: "KPO", latitude: 35.9879, longitude: 129.4204, timeZoneID: KST),
    Airport(icao: "RKPS", iata: "HIN", latitude: 35.0886, longitude: 128.0703, timeZoneID: KST),
    Airport(icao: "RKNW", iata: "WJU", latitude: 37.4381, longitude: 127.9604, timeZoneID: KST),
    // 일본
    Airport(icao: "RJCC", iata: "CTS", latitude: 42.7752, longitude: 141.6923, timeZoneID: JST),
    Airport(icao: "RJCH", iata: "HKD", latitude: 41.7700, longitude: 140.8219, timeZoneID: JST),
    Airport(icao: "RJBB", iata: "KIX", latitude: 34.4320, longitude: 135.2304, timeZoneID: JST),
    Airport(icao: "RJBE", iata: "UKB", latitude: 34.6328, longitude: 135.2239, timeZoneID: JST),
    Airport(icao: "RJAA", iata: "NRT", latitude: 35.7720, longitude: 140.3929, timeZoneID: JST),
    Airport(icao: "RJTT", iata: "HND", latitude: 35.5494, longitude: 139.7798, timeZoneID: JST),
    Airport(icao: "RJGG", iata: "NGO", latitude: 34.8584, longitude: 136.8054, timeZoneID: JST),
    Airport(icao: "RJFF", iata: "FUK", latitude: 33.5859, longitude: 130.4511, timeZoneID: JST),
    Airport(icao: "ROAH", iata: "OKA", latitude: 26.1958, longitude: 127.6459, timeZoneID: JST),
    Airport(icao: "RJSS", iata: "SDJ", latitude: 38.1397, longitude: 140.9170, timeZoneID: JST),
    Airport(icao: "RJSN", iata: "KIJ", latitude: 37.9559, longitude: 139.1206, timeZoneID: JST),
    Airport(icao: "RJOT", iata: "TAK", latitude: 34.2142, longitude: 134.0156, timeZoneID: JST),
    Airport(icao: "RJOB", iata: "OKJ", latitude: 34.7569, longitude: 133.8553, timeZoneID: JST),
    Airport(icao: "RJOA", iata: "HIJ", latitude: 34.4361, longitude: 132.9194, timeZoneID: JST),
    Airport(icao: "RJOM", iata: "MYJ", latitude: 33.8272, longitude: 132.6997, timeZoneID: JST),
    Airport(icao: "RJNK", iata: "KMQ", latitude: 36.3946, longitude: 136.4065, timeZoneID: JST),
    Airport(icao: "RJNS", iata: "FSZ", latitude: 34.7960, longitude: 138.1894, timeZoneID: JST),
    Airport(icao: "RJFK", iata: "KOJ", latitude: 31.8034, longitude: 130.7194, timeZoneID: JST),
    Airport(icao: "RJFM", iata: "KMI", latitude: 31.8772, longitude: 131.4486, timeZoneID: JST),
    Airport(icao: "RJFT", iata: "KMJ", latitude: 32.8373, longitude: 130.8551, timeZoneID: JST),
    Airport(icao: "RJFU", iata: "NGS", latitude: 32.9169, longitude: 129.9136, timeZoneID: JST),
    // 중국
    Airport(icao: "ZBAA", iata: "PEK", latitude: 40.0801, longitude: 116.5846, timeZoneID: CST),
    Airport(icao: "ZBAD", iata: "PKX", latitude: 39.5098, longitude: 116.4105, timeZoneID: CST),
    Airport(icao: "ZSPD", iata: "PVG", latitude: 31.1443, longitude: 121.8083, timeZoneID: CST),
    Airport(icao: "ZSSS", iata: "SHA", latitude: 31.1979, longitude: 121.3363, timeZoneID: CST),
    Airport(icao: "ZGGG", iata: "CAN", latitude: 23.3924, longitude: 113.2988, timeZoneID: CST),
    Airport(icao: "ZGSZ", iata: "SZX", latitude: 22.6393, longitude: 113.8107, timeZoneID: CST),
    Airport(icao: "ZSQD", iata: "TAO", latitude: 36.3617, longitude: 120.0881, timeZoneID: CST),
    Airport(icao: "ZSYT", iata: "YNT", latitude: 37.6572, longitude: 120.9872, timeZoneID: CST),
    Airport(icao: "ZSWH", iata: "WEH", latitude: 37.1871, longitude: 122.2290, timeZoneID: CST),
    Airport(icao: "ZYTL", iata: "DLC", latitude: 38.9657, longitude: 121.5386, timeZoneID: CST),
    Airport(icao: "ZYTX", iata: "SHE", latitude: 41.6398, longitude: 123.4834, timeZoneID: CST),
    Airport(icao: "ZYCC", iata: "CGQ", latitude: 43.9962, longitude: 125.6850, timeZoneID: CST),
    Airport(icao: "ZYHB", iata: "HRB", latitude: 45.6234, longitude: 126.2503, timeZoneID: CST),
    Airport(icao: "ZYYJ", iata: "YNJ", latitude: 42.8828, longitude: 129.4513, timeZoneID: CST),
    Airport(icao: "ZSNJ", iata: "NKG", latitude: 31.7420, longitude: 118.8620, timeZoneID: CST),
    Airport(icao: "ZSHC", iata: "HGH", latitude: 30.2295, longitude: 120.4344, timeZoneID: CST),
    Airport(icao: "ZUUU", iata: "CTU", latitude: 30.5785, longitude: 103.9471, timeZoneID: CST),
    Airport(icao: "ZUTF", iata: "TFU", latitude: 30.3125, longitude: 104.4442, timeZoneID: CST),
    Airport(icao: "ZGHA", iata: "CSX", latitude: 28.1892, longitude: 113.2200, timeZoneID: CST),
    Airport(icao: "ZLXY", iata: "XIY", latitude: 34.4471, longitude: 108.7516, timeZoneID: CST),
    Airport(icao: "ZUCK", iata: "CKG", latitude: 29.7192, longitude: 106.6417, timeZoneID: CST),
    Airport(icao: "ZHHH", iata: "WUH", latitude: 30.7838, longitude: 114.2081, timeZoneID: CST),
    Airport(icao: "ZJSY", iata: "SYX", latitude: 18.3029, longitude: 109.4122, timeZoneID: CST),
    Airport(icao: "VHHH", iata: "HKG", latitude: 22.3080, longitude: 113.9185, timeZoneID: "Asia/Hong_Kong"),
    Airport(icao: "VMMC", iata: "MFM", latitude: 22.1496, longitude: 113.5916, timeZoneID: "Asia/Macau"),
    // 대만
    Airport(icao: "RCTP", iata: "TPE", latitude: 25.0777, longitude: 121.2328, timeZoneID: "Asia/Taipei"),
    Airport(icao: "RCSS", iata: "TSA", latitude: 25.0694, longitude: 121.5525, timeZoneID: "Asia/Taipei"),
    Airport(icao: "RCKH", iata: "KHH", latitude: 22.5771, longitude: 120.3500, timeZoneID: "Asia/Taipei"),
    // 동남아
    Airport(icao: "VVTS", iata: "SGN", latitude: 10.8188, longitude: 106.6519, timeZoneID: "Asia/Ho_Chi_Minh"),
    Airport(icao: "VVNB", iata: "HAN", latitude: 21.2212, longitude: 105.8072, timeZoneID: "Asia/Ho_Chi_Minh"),
    Airport(icao: "VVDN", iata: "DAD", latitude: 16.0439, longitude: 108.1994, timeZoneID: "Asia/Ho_Chi_Minh"),
    Airport(icao: "VVCR", iata: "CXR", latitude: 11.9982, longitude: 109.2194, timeZoneID: "Asia/Ho_Chi_Minh"),
    Airport(icao: "VVPQ", iata: "PQC", latitude: 10.1698, longitude: 103.9931, timeZoneID: "Asia/Ho_Chi_Minh"),
    Airport(icao: "VTBS", iata: "BKK", latitude: 13.6900, longitude: 100.7501, timeZoneID: "Asia/Bangkok"),
    Airport(icao: "VTBD", iata: "DMK", latitude: 13.9126, longitude: 100.6067, timeZoneID: "Asia/Bangkok"),
    Airport(icao: "VTSP", iata: "HKT", latitude: 8.1132, longitude: 98.3169, timeZoneID: "Asia/Bangkok"),
    Airport(icao: "VTCC", iata: "CNX", latitude: 18.7668, longitude: 98.9626, timeZoneID: "Asia/Bangkok"),
    Airport(icao: "RPLL", iata: "MNL", latitude: 14.5086, longitude: 121.0198, timeZoneID: "Asia/Manila"),
    Airport(icao: "RPVM", iata: "CEB", latitude: 10.3075, longitude: 123.9794, timeZoneID: "Asia/Manila"),
    Airport(icao: "RPLC", iata: "CRK", latitude: 15.1860, longitude: 120.5603, timeZoneID: "Asia/Manila"),
    Airport(icao: "WSSS", iata: "SIN", latitude: 1.3644, longitude: 103.9915, timeZoneID: "Asia/Singapore"),
    Airport(icao: "WMKK", iata: "KUL", latitude: 2.7456, longitude: 101.7099, timeZoneID: "Asia/Kuala_Lumpur"),
    Airport(icao: "WBKK", iata: "BKI", latitude: 5.9372, longitude: 116.0510, timeZoneID: "Asia/Kuching"),
    Airport(icao: "WIII", iata: "CGK", latitude: -6.1256, longitude: 106.6559, timeZoneID: "Asia/Jakarta"),
    Airport(icao: "WADD", iata: "DPS", latitude: -8.7482, longitude: 115.1672, timeZoneID: "Asia/Makassar"),
    Airport(icao: "VLVT", iata: "VTE", latitude: 17.9883, longitude: 102.5633, timeZoneID: "Asia/Vientiane"),
    // 기타
    Airport(icao: "ZMCK", iata: "ULN", latitude: 47.6469, longitude: 106.8195, timeZoneID: "Asia/Ulaanbaatar"),
    Airport(icao: "PGUM", iata: "GUM", latitude: 13.4834, longitude: 144.7960, timeZoneID: "Pacific/Guam"),
    Airport(icao: "PGSN", iata: "SPN", latitude: 15.1190, longitude: 145.7290, timeZoneID: "Pacific/Saipan"),
    Airport(icao: "UHWW", iata: "VVO", latitude: 43.3990, longitude: 132.1480, timeZoneID: "Asia/Vladivostok"),
    Airport(icao: "UHHH", iata: "KHV", latitude: 48.5280, longitude: 135.1883, timeZoneID: "Asia/Vladivostok"),
    Airport(icao: "UAAA", iata: "ALA", latitude: 43.3521, longitude: 77.0405, timeZoneID: "Asia/Almaty"),
    Airport(icao: "UTTT", iata: "TAS", latitude: 41.2579, longitude: 69.2812, timeZoneID: "Asia/Tashkent"),
    Airport(icao: "VIDP", iata: "DEL", latitude: 28.5562, longitude: 77.1000, timeZoneID: "Asia/Kolkata"),
]

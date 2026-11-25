import Foundation

/// 전체 백업 파일 (JSON). 구글 드라이브·iCloud Drive·파일 앱 어디에 둬도 되고, 다시 불러올 수 있습니다.
public struct LogbookBackup: Codable, Sendable {
    public var format = "pilot-logbook-backup"
    public var version = 1
    public var exportedAt: Date
    public var carryForward: CarryForward?
    public var entries: [LogEntryRecord]

    public init(exportedAt: Date = Date(), carryForward: CarryForward?, entries: [LogEntryRecord]) {
        self.exportedAt = exportedAt
        self.carryForward = carryForward
        self.entries = entries
    }

    public func encoded() throws -> Data {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try enc.encode(self)
    }

    public static func decode(_ data: Data) throws -> LogbookBackup {
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        let b = try dec.decode(LogbookBackup.self, from: data)
        guard b.format == "pilot-logbook-backup" else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return b
    }
}

public enum BackupMerge {
    public struct Plan: Equatable, Sendable {
        public var insert: [LogEntryRecord] = []
        public var update: [LogEntryRecord] = []
        public var unchanged = 0
    }

    /// 같은 id면 더 나중에 고친 쪽을 남김. 없는 id는 새로 추가.
    public static func plan(existing: [LogEntryRecord], incoming: [LogEntryRecord]) -> Plan {
        let byID = Dictionary(existing.map { ($0.id, $0) }, uniquingKeysWith: { a, b in a.updatedAt >= b.updatedAt ? a : b })
        var p = Plan()
        for r in incoming {
            if let cur = byID[r.id] {
                if r.updatedAt > cur.updatedAt { p.update.append(r) } else { p.unchanged += 1 }
            } else {
                p.insert.append(r)
            }
        }
        return p
    }
}

/// 회사 Flight Log와 같은 칸 순서의 CSV (엑셀·구글 시트에서 열기 용)
public enum CompanyCSV {
    public static let header = ["Date", "A/C", "HL", "FLT NO", "Route", "IRR", "Duty", "R/O", "R/I",
                                "Block", "T/S", "N/T", "I/T", "T/O", "L/D", "OFF", "ON", "SIM", "Remarks"]

    public static func make(_ records: [LogEntryRecord], airports: AirportDatabase = .standard) -> String {
        var lines = [header.joined(separator: ",")]
        let sorted = records.sorted { ($0.logDate, $0.eventDate) < ($1.logDate, $1.eventDate) }
        for r in sorted {
            let route = r.originICAO.isEmpty && r.destinationICAO.isEmpty ? "" :
                "\(airports.displayCode(r.originICAO))-\(airports.displayCode(r.destinationICAO))"
            let fields: [String] = [
                LogDate.companyStyle(r.logDate), r.aircraftType, r.registration, r.flightNumber, route,
                r.irregular, r.duty,
                r.outUTC.map(TimeText.companyStamp) ?? "", r.inUTC.map(TimeText.companyStamp) ?? "",
                TimeText.hmm(r.blockMinutes), TimeText.hmm(r.flightMinutes),
                TimeText.hmm(r.nightMinutes), TimeText.hmm(r.instrumentMinutes),
                r.takeoffs > 0 ? "*" : "", r.landings > 0 ? "*" : "",
                r.offUTC.map(TimeText.zulu) ?? "", r.onUTC.map(TimeText.zulu) ?? "",
                r.isSimulator ? "Y" : "", r.remarks,
            ]
            lines.append(fields.map(escape).joined(separator: ","))
        }
        // 엑셀이 한글을 깨지 않도록 BOM
        return "\u{FEFF}" + lines.joined(separator: "\r\n") + "\r\n"
    }

    static func escape(_ s: String) -> String {
        if s.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" || $0 == "\r" }) {
            return "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return s
    }
}

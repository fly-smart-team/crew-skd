import Foundation

/// OCR이 돌려준 글자 덩어리 하나.
/// 좌표는 이미지 기준 0~1 정규화, **왼쪽 위가 원점** (Vision의 boundingBox를 뒤집어서 넣어 주세요).
public struct OCRToken: Hashable, Sendable {
    public var text: String
    public var minX: Double
    public var minY: Double
    public var maxX: Double
    public var maxY: Double
    public var confidence: Double

    public init(text: String, minX: Double, minY: Double, maxX: Double, maxY: Double, confidence: Double = 1) {
        self.text = text
        self.minX = minX
        self.minY = minY
        self.maxX = maxX
        self.maxY = maxY
        self.confidence = confidence
    }
}

public enum OOOIField: String, CaseIterable, Codable, Sendable {
    case flightID, origin, destination, screenDate, screenUTC
    case out, off, on, `in`, block, flight

    public var label: String {
        switch self {
        case .flightID: return "편명"
        case .origin: return "출발"
        case .destination: return "도착"
        case .screenDate: return "화면 날짜"
        case .screenUTC: return "화면 UTC"
        case .out: return "OUT"
        case .off: return "OFF"
        case .on: return "ON"
        case .in: return "IN"
        case .block: return "BLOCK"
        case .flight: return "FLIGHT"
        }
    }
}

public struct ScanNote: Hashable, Sendable {
    public enum Kind: String, Sendable {
        case missing      // 읽지 못함
        case derived      // 다른 값으로 계산해서 채움
        case corrected    // 오인식을 검산으로 고침
        case guessed      // 잘린 글자를 추정
        case mismatch     // 검산 불일치 (확인 필요)
        case unknownAirport
    }
    public var field: OOOIField
    public var kind: Kind
    public var message: String
}

/// ACARS "AOC OOOI STATUS" 화면에서 읽어낸 값
public struct OOOIScreenReading: Sendable {
    public var isOOOIPage = false
    public var flightID: String?
    public var originICAO: String?
    public var destinationICAO: String?
    public var screenDay: Int?
    public var screenMonth: Int?
    public var screenYear: Int?
    public var screenUTC: ClockTime?
    public var out: ClockTime?
    public var off: ClockTime?
    public var on: ClockTime?
    public var inTime: ClockTime?
    public var blockMinutes: Int?
    public var flightMinutes: Int?
    public var notes: [ScanNote] = []

    public init() {}

    public func notes(for field: OOOIField) -> [ScanNote] { notes.filter { $0.field == field } }

    /// BLOCK = IN−OUT, FLIGHT = ON−OFF 가 둘 다 맞는지
    public var checksumsPass: Bool {
        guard let o = out, let f = off, let n = on, let i = inTime,
              let b = blockMinutes, let fl = flightMinutes else { return false }
        return ClockTime.minutes(from: o, to: i) == b && ClockTime.minutes(from: f, to: n) == fl
    }
}

// MARK: - 글자 보정

enum OCRText {
    private static let toDigit: [Character: Character] = [
        "O": "0", "o": "0", "Ø": "0", "ø": "0", "D": "0", "Q": "0", "°": "0",
        "I": "1", "l": "1", "|": "1", "i": "1", "!": "1", "]": "1", "[": "1",
        "Z": "2", "z": "2", "S": "5", "s": "5", "B": "8", "G": "6", "b": "6",
        "T": "7", "A": "4", "g": "9", "q": "9",
    ]
    private static let toLetter: [Character: Character] = [
        "0": "O", "Ø": "O", "ø": "O", "1": "I", "|": "I", "5": "S", "8": "B", "6": "G", "2": "Z",
    ]

    /// 숫자 칸: 숫자로 보이는 글자를 숫자로 바꿈. 숫자가 아닌 게 남으면 nil
    static func digits<S: StringProtocol>(_ s: S) -> String? {
        var out = ""
        for ch in s {
            if ch.isASCII && ch.isNumber { out.append(ch) }
            else if let d = toDigit[ch] { out.append(d) }
            else { return nil }
        }
        return out
    }

    /// 영문 칸: 대문자로, 글자처럼 보이는 숫자를 글자로. A-Z 외의 글자가 남으면 nil
    static func letters<S: StringProtocol>(_ s: S) -> String? {
        var out = ""
        for ch in s {
            let c = toLetter[ch] ?? Character(String(ch).uppercased())
            guard c.isASCII, c.isLetter else { return nil }
            out.append(c)
        }
        return out
    }

    /// 라벨 비교용: 글자만 남기고 대문자로
    static func labelKey(_ s: String) -> String {
        var out = ""
        for ch in s {
            let c = toLetter[ch] ?? Character(String(ch).uppercased())
            if c.isASCII, c.isLetter { out.append(c) }
        }
        return out
    }

    static func editDistance(_ a: String, _ b: String) -> Int {
        let a = Array(a), b = Array(b)
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var prev = Array(0...b.count)
        for i in 1...a.count {
            var cur = [i] + Array(repeating: 0, count: b.count)
            for j in 1...b.count {
                cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
            }
            prev = cur
        }
        return prev[b.count]
    }
}

// MARK: - 값 해석기

enum ValueParsers {
    /// "2319Z", "2319", "Ø5Ø4Z" → ClockTime
    static func zuluTime(_ raw: String) -> ClockTime? {
        var s = raw.replacingOccurrences(of: " ", with: "")
        if s.count == 5, let last = s.last, "Zz2".contains(last) { s.removeLast() }
        guard s.count == 4, let d = OCRText.digits(s) else { return nil }
        return ClockTime(digits: d)
    }

    /// 화면 UTC "Ø5Ø9" (Z 없음)
    static func clock(_ raw: String) -> ClockTime? {
        let s = raw.replacingOccurrences(of: " ", with: "")
        guard s.count == 4, let d = OCRText.digits(s) else { return nil }
        return ClockTime(digits: d)
    }

    /// "Ø545" → 345분
    static func duration(_ raw: String) -> Int? {
        let s = raw.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ":", with: "")
        guard s.count == 4, let d = OCRText.digits(s), let v = Int(d), v % 100 < 60 else { return nil }
        return (v / 100) * 60 + v % 100
    }

    /// "OZØ731" → "OZ731"
    static func flightID(_ raw: String) -> String? {
        let s = Array(raw.replacingOccurrences(of: " ", with: ""))
        guard (3...7).contains(s.count) else { return nil }
        // 항공사 코드 2자리: 숫자가 섞일 수 있음(7C 등). 0/Ø는 옆 글자가 영문이면 O로 본다.
        var prefix = ""
        for (i, ch) in s.prefix(2).enumerated() {
            let other = s[1 - i]
            let otherIsLetter = other.isLetter && other != "Ø" && other != "ø"
            if (ch == "0" || ch == "Ø" || ch == "ø") && otherIsLetter { prefix.append("O") }
            else {
                let up = Character(String(ch).uppercased())
                guard up.isASCII, up.isLetter || up.isNumber else { return nil }
                prefix.append(up)
            }
        }
        guard prefix.contains(where: { $0.isLetter }) else { return nil }
        var rest = String(s.dropFirst(2))
        var suffix = ""
        if let last = rest.last, last.isASCII, last.isLetter, !"OoIlSZBDQ".contains(last) {
            suffix = String(last).uppercased()
            rest.removeLast()
        }
        guard (1...4).contains(rest.count), let d = OCRText.digits(rest), let n = Int(d) else { return nil }
        return "\(prefix)\(n)\(suffix)"
    }

    /// "RKSI/VVTS" → ("RKSI", "VVTS"), 잘린 "RKSI/VVT" → ("RKSI", "VVT")
    static func route(_ raw: String) -> (String, String)? {
        let s = raw.replacingOccurrences(of: " ", with: "")
        let parts = s.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2, let a = OCRText.letters(parts[0]), a.count == 4,
              let b = OCRText.letters(parts[1]), b.count <= 4 else { return nil }
        return (a, b)
    }

    private static let months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

    /// "25NOV26" → (25, 11, 2026). 잘린 "25NOV2" → (25, 11, nil)
    static func screenDate(_ raw: String) -> (Int, Int, Int?)? {
        let s = Array(raw.replacingOccurrences(of: " ", with: ""))
        guard s.count >= 5, let dd = OCRText.digits(String(s[0..<2])), let day = Int(dd), (1...31).contains(day),
              let mon = OCRText.letters(String(s[2..<5])) else { return nil }
        guard let mi = months.firstIndex(of: mon) ?? months.firstIndex(where: { OCRText.editDistance($0, mon) <= 1 })
        else { return nil }
        var year: Int?
        if s.count >= 7, let yy = OCRText.digits(String(s[5..<7])), let y = Int(yy) { year = 2000 + y }
        return (day, mi + 1, year)
    }

    static func isDashes(_ raw: String) -> Bool {
        raw.contains("-") && raw.allSatisfy { "-–—_Zz ".contains($0) }
    }
}

// MARK: - 화면 해석

public struct OOOIScreenParser {
    public var airports: AirportDatabase

    public init(airports: AirportDatabase = .standard) {
        self.airports = airports
    }

    struct Word {
        var text: String
        var minX: Double
        var maxX: Double
        var midY: Double
        var height: Double
        var centerX: Double { (minX + maxX) / 2 }
        var charWidth: Double { (maxX - minX) / Double(max(text.count, 1)) }
    }

    enum LabelKind: Equatable {
        case flightID, route, returnTime, utc, date, out, off, on, `in`, block, flight
    }

    struct Label {
        var kind: LabelKind
        var centerX: Double
    }

    public func parse(_ tokens: [OCRToken]) -> OOOIScreenReading {
        var reading = OOOIScreenReading()
        let rows = Self.rows(from: Self.words(from: tokens))
        let heights = rows.flatMap { $0.map(\.height) }.sorted()
        let medianH = heights.isEmpty ? 0.02 : heights[heights.count / 2]

        var found: [LabelKind: (String, Double)] = [:]   // 라벨 → (값 텍스트, 거리)

        for (i, row) in rows.enumerated() {
            let (labels, isHeader) = Self.labels(in: row)
            if isHeader { reading.isOOOIPage = true }
            guard !labels.isEmpty, i + 1 < rows.count else { continue }
            let valueRow = rows[i + 1]
            guard let vy = valueRow.first?.midY, let ly = row.first?.midY, vy - ly <= medianH * 3.5 else { continue }

            for word in Self.mergeSlashes(valueRow) {
                // 이 글자를 받아들일 수 있는 라벨 중 가로로 가장 가까운 라벨에 배정
                let accepting = labels.filter { Self.accepts($0.kind, word.text) }
                guard let best = accepting.min(by: { abs($0.centerX - word.centerX) < abs($1.centerX - word.centerX) })
                else { continue }
                let dist = abs(best.centerX - word.centerX)
                if let existing = found[best.kind], existing.1 <= dist { continue }
                found[best.kind] = (word.text, dist)
            }
        }

        let labelCount = found.keys.filter { [.out, .off, .on, .in, .block, .flight].contains($0) }.count
        if labelCount >= 3 { reading.isOOOIPage = true }

        if let t = found[.flightID]?.0 { reading.flightID = ValueParsers.flightID(t) }
        if let t = found[.utc]?.0 { reading.screenUTC = ValueParsers.clock(t) }
        if let t = found[.date]?.0, let d = ValueParsers.screenDate(t) {
            reading.screenDay = d.0
            reading.screenMonth = d.1
            reading.screenYear = d.2
        }
        if let t = found[.out]?.0 { reading.out = ValueParsers.zuluTime(t) }
        if let t = found[.off]?.0 { reading.off = ValueParsers.zuluTime(t) }
        if let t = found[.on]?.0 { reading.on = ValueParsers.zuluTime(t) }
        if let t = found[.in]?.0 { reading.inTime = ValueParsers.zuluTime(t) }
        if let t = found[.block]?.0 { reading.blockMinutes = ValueParsers.duration(t) }
        if let t = found[.flight]?.0 { reading.flightMinutes = ValueParsers.duration(t) }
        if let t = found[.route]?.0, let r = ValueParsers.route(t) {
            reading.originICAO = resolveAirport(r.0, field: .origin, notes: &reading.notes)
            reading.destinationICAO = resolveAirport(r.1, field: .destination, notes: &reading.notes)
        }

        let checks: [(OOOIField, Bool)] = [
            (.flightID, reading.flightID != nil), (.origin, reading.originICAO != nil),
            (.destination, reading.destinationICAO != nil), (.out, reading.out != nil),
            (.off, reading.off != nil), (.on, reading.on != nil), (.in, reading.inTime != nil),
            (.block, reading.blockMinutes != nil), (.flight, reading.flightMinutes != nil),
        ]
        for (field, ok) in checks where !ok {
            reading.notes.append(ScanNote(field: field, kind: .missing, message: "\(field.label)을(를) 읽지 못했습니다"))
        }

        OOOIChecksum.reconcile(&reading)
        return reading
    }

    private func resolveAirport(_ code: String, field: OOOIField, notes: inout [ScanNote]) -> String? {
        if code.count == 4 {
            if airports.airport(code) == nil {
                notes.append(ScanNote(field: field, kind: .unknownAirport,
                                      message: "\(code)는 공항 목록에 없습니다. 야간 시간을 계산하려면 설정에서 추가하세요"))
            }
            return code
        }
        // 사진 가장자리에서 잘린 코드: 앞글자로 유일하게 정해지면 채움
        let candidates = code.count >= 2 ? airports.icaoCandidates(prefix: code) : []
        if candidates.count == 1 {
            let icao = candidates[0].icao
            notes.append(ScanNote(field: field, kind: .guessed, message: "\(code)… 가 잘려 \(icao)로 추정했습니다"))
            return icao
        }
        return nil
    }

    // MARK: 단계별 처리

    /// OCR 덩어리를 단어로 쪼갬. MCDU는 고정폭 글꼴이라 글자 위치를 비례로 추정할 수 있다.
    static func words(from tokens: [OCRToken]) -> [Word] {
        var result: [Word] = []
        for t in tokens {
            let chars = Array(t.text)
            guard !chars.isEmpty else { continue }
            let cw = (t.maxX - t.minX) / Double(chars.count)
            let midY = (t.minY + t.maxY) / 2, h = t.maxY - t.minY
            var start: Int?
            for i in 0...chars.count {
                let isSpace = i == chars.count || chars[i].isWhitespace
                if !isSpace, start == nil { start = i }
                if isSpace, let s = start {
                    result.append(Word(text: String(chars[s..<i]), minX: t.minX + cw * Double(s),
                                       maxX: t.minX + cw * Double(i), midY: midY, height: h))
                    start = nil
                }
            }
        }
        return result
    }

    /// 같은 높이의 단어를 한 줄로 묶고, 줄 안에서 왼쪽→오른쪽 정렬
    static func rows(from words: [Word]) -> [[Word]] {
        guard !words.isEmpty else { return [] }
        let hs = words.map(\.height).sorted()
        let tol = hs[hs.count / 2] * 0.5
        var rows: [[Word]] = []
        for w in words.sorted(by: { $0.midY < $1.midY }) {
            if var last = rows.last {
                let mean = last.map(\.midY).reduce(0, +) / Double(last.count)
                if abs(w.midY - mean) <= tol {
                    last.append(w)
                    rows[rows.count - 1] = last
                    continue
                }
            }
            rows.append([w])
        }
        return rows.map { row in
            let sorted = row.sorted { $0.minX < $1.minX }
            // OCR이 "2 3 1 9Z"처럼 쪼갠 조각을 다시 붙임 (간격이 글자 반 칸보다 좁을 때만)
            var merged: [Word] = []
            for w in sorted {
                if var prev = merged.last {
                    let gap = w.minX - prev.maxX
                    if gap < min(prev.charWidth, w.charWidth) * 0.5 {
                        prev.text += w.text
                        prev.maxX = w.maxX
                        merged[merged.count - 1] = prev
                        continue
                    }
                }
                merged.append(w)
            }
            return merged
        }
    }

    /// "RKSI/" "VVTS" 처럼 슬래시에서 갈라진 단어 붙이기
    static func mergeSlashes(_ row: [Word]) -> [Word] {
        var out: [Word] = []
        for w in row {
            if var prev = out.last, prev.text.hasSuffix("/") || w.text.hasPrefix("/") {
                prev.text += w.text
                prev.maxX = w.maxX
                out[out.count - 1] = prev
            } else {
                out.append(w)
            }
        }
        return out
    }

    static func labels(in row: [Word]) -> ([Label], Bool) {
        var labels: [Label] = []
        var isHeader = false
        let keys = row.map { OCRText.labelKey($0.text) }
        var i = 0
        func fuzzy(_ k: String, _ target: String) -> Bool {
            k == target || (target.count >= 5 && OCRText.editDistance(k, target) <= 1)
        }
        while i < row.count {
            let k = keys[i], w = row[i]
            let next = i + 1 < row.count ? keys[i + 1] : ""
            if fuzzy(k, "STATUS") || k == "OOOI" {
                isHeader = true
            } else if fuzzy(k, "FLIGHT") {
                if next == "ID" {
                    labels.append(Label(kind: .flightID, centerX: (w.minX + row[i + 1].maxX) / 2))
                    i += 1
                } else {
                    labels.append(Label(kind: .flight, centerX: w.centerX))
                }
            } else if fuzzy(k, "RETURN") {
                if next == "TO" { i += 1 } // "RETURN TO <AOC MENU" 는 메뉴
                else { labels.append(Label(kind: .returnTime, centerX: w.centerX)) }
            } else if fuzzy(k, "ORIGDEST") || k == "ORIG" {
                var cx = w.centerX
                if k == "ORIG", next == "DEST" { cx = (w.minX + row[i + 1].maxX) / 2; i += 1 }
                labels.append(Label(kind: .route, centerX: cx))
            } else if fuzzy(k, "BLOCK") {
                labels.append(Label(kind: .block, centerX: w.centerX))
            } else {
                let map: [String: LabelKind] = ["OUT": .out, "OFF": .off, "ON": .on, "IN": .in, "UTC": .utc, "DATE": .date]
                // 라벨 글자만 있는 단어여야 함 (값 "0N" 같은 오인식 방지: 원문에 숫자가 섞이면 제외)
                if let kind = map[k], w.text.count == k.count { labels.append(Label(kind: kind, centerX: w.centerX)) }
            }
            i += 1
        }
        return (labels, isHeader)
    }

    static func accepts(_ kind: LabelKind, _ text: String) -> Bool {
        switch kind {
        case .flightID: return ValueParsers.flightID(text) != nil
        case .route: return ValueParsers.route(text) != nil
        case .returnTime: return ValueParsers.isDashes(text) || ValueParsers.zuluTime(text) != nil
        case .utc: return ValueParsers.clock(text) != nil
        case .date: return ValueParsers.screenDate(text) != nil
        case .out, .off, .on, .in: return ValueParsers.zuluTime(text) != nil
        case .block, .flight: return ValueParsers.duration(text) != nil
        }
    }
}

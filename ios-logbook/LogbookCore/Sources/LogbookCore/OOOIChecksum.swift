import Foundation

/// 화면에 함께 나오는 BLOCK(IN−OUT)·FLIGHT(ON−OFF)를 검산값으로 써서
/// 빠진 값을 채우고, 한 글자 오인식을 고칩니다.
public enum OOOIChecksum {
    /// 지상 이동(OUT→OFF, ON→IN)이 이보다 길면 비정상으로 봄
    static let maxTaxiMinutes = 150

    /// OCR이 서로 헷갈리기 쉬운 숫자
    static let confusable: [Character: [Character]] = [
        "0": ["8", "6", "9"], "1": ["7", "4"], "2": ["7", "3"], "3": ["8", "9", "5"],
        "4": ["1", "9"], "5": ["6", "3", "8"], "6": ["5", "8", "0"], "7": ["1", "2"],
        "8": ["0", "3", "6", "9", "5"], "9": ["8", "0", "3", "4"],
    ]

    struct Values: Equatable {
        var out, off, on, inn: ClockTime?
        var block, flight: Int?

        func isConsistent() -> Bool {
            guard let o = out, let f = off, let n = on, let i = inn, let b = block, let fl = flight else { return false }
            return ClockTime.minutes(from: o, to: i) == b
                && ClockTime.minutes(from: f, to: n) == fl
                && ClockTime.minutes(from: o, to: f) <= maxTaxiMinutes
                && ClockTime.minutes(from: n, to: i) <= maxTaxiMinutes
                && fl <= b
        }
    }

    public static func reconcile(_ r: inout OOOIScreenReading) {
        var v = Values(out: r.out, off: r.off, on: r.on, inn: r.inTime, block: r.blockMinutes, flight: r.flightMinutes)
        var notes: [ScanNote] = []

        // 1) 셋 중 하나만 빠졌으면 나머지 둘로 계산
        derive(&v.out, &v.inn, &v.block, startField: .out, endField: .in, durField: .block, notes: &notes)
        derive(&v.off, &v.on, &v.flight, startField: .off, endField: .on, durField: .flight, notes: &notes)

        let complete = v.out != nil && v.off != nil && v.on != nil && v.inn != nil && v.block != nil && v.flight != nil
        if complete && !v.isConsistent() {
            // 2) 한 글자만 바꿔서 모든 검산이 맞는 경우가 딱 하나면 그걸로 고침
            let fixes = singleDigitFixes(v)
            if fixes.count == 1, let fix = fixes.first {
                v = fix.values
                notes.append(ScanNote(field: fix.field, kind: .corrected,
                                      message: "\(fix.field.label) \(fix.from) → \(fix.to) (BLOCK/FLIGHT 검산으로 수정)"))
            } else {
                let blockOK = ClockTime.minutes(from: v.out!, to: v.inn!) == v.block!
                let flightOK = ClockTime.minutes(from: v.off!, to: v.on!) == v.flight!
                if !blockOK {
                    notes.append(ScanNote(field: .block, kind: .mismatch,
                                          message: "IN−OUT(\(TimeText.hmm(ClockTime.minutes(from: v.out!, to: v.inn!)))) ≠ BLOCK(\(TimeText.hmm(v.block!))). 사진과 비교해 주세요"))
                }
                if !flightOK {
                    notes.append(ScanNote(field: .flight, kind: .mismatch,
                                          message: "ON−OFF(\(TimeText.hmm(ClockTime.minutes(from: v.off!, to: v.on!)))) ≠ FLIGHT(\(TimeText.hmm(v.flight!))). 사진과 비교해 주세요"))
                }
                if blockOK && flightOK {
                    notes.append(ScanNote(field: .out, kind: .mismatch, message: "지상 이동 시간이 비정상적으로 깁니다. 시각을 확인해 주세요"))
                }
            }
        }

        // 채운 필드의 "읽지 못함" 메모는 지움
        let filled: [(OOOIField, Bool)] = [(.out, v.out != nil), (.off, v.off != nil), (.on, v.on != nil),
                                           (.in, v.inn != nil), (.block, v.block != nil), (.flight, v.flight != nil)]
        for (field, ok) in filled where ok {
            r.notes.removeAll { $0.field == field && $0.kind == .missing }
        }
        r.out = v.out; r.off = v.off; r.on = v.on; r.inTime = v.inn
        r.blockMinutes = v.block; r.flightMinutes = v.flight
        r.notes.append(contentsOf: notes)
    }

    private static func derive(_ start: inout ClockTime?, _ end: inout ClockTime?, _ dur: inout Int?,
                               startField: OOOIField, endField: OOOIField, durField: OOOIField,
                               notes: inout [ScanNote]) {
        switch (start, end, dur) {
        case (nil, let e?, let d?):
            start = e.adding(minutes: -d)
            notes.append(ScanNote(field: startField, kind: .derived, message: "\(startField.label)을 \(endField.label)−\(durField.label)로 계산했습니다"))
        case (let s?, nil, let d?):
            end = s.adding(minutes: d)
            notes.append(ScanNote(field: endField, kind: .derived, message: "\(endField.label)을 \(startField.label)+\(durField.label)로 계산했습니다"))
        case (let s?, let e?, nil):
            dur = ClockTime.minutes(from: s, to: e)
            notes.append(ScanNote(field: durField, kind: .derived, message: "\(durField.label)를 시각으로 계산했습니다"))
        default:
            break
        }
    }

    struct Fix {
        var field: OOOIField
        var from: String
        var to: String
        var values: Values
    }

    static func singleDigitFixes(_ v: Values) -> [Fix] {
        var fixes: [Fix] = []

        func variants(_ text: String) -> [String] {
            var out: [String] = []
            let chars = Array(text)
            for (i, ch) in chars.enumerated() {
                for alt in confusable[ch] ?? [] {
                    var c = chars
                    c[i] = alt
                    out.append(String(c))
                }
            }
            return out
        }
        func durText(_ m: Int) -> String { TimeText.pad2(m / 60) + TimeText.pad2(m % 60) }

        let clockFields: [(OOOIField, WritableKeyPath<Values, ClockTime?>)] =
            [(.out, \.out), (.off, \.off), (.on, \.on), (.in, \.inn)]
        for (field, kp) in clockFields {
            guard let t = v[keyPath: kp] else { continue }
            for alt in variants(t.description) {
                guard let nt = ClockTime(digits: alt) else { continue }
                var c = v
                c[keyPath: kp] = nt
                if c.isConsistent() { fixes.append(Fix(field: field, from: t.description, to: alt, values: c)) }
            }
        }
        let durFields: [(OOOIField, WritableKeyPath<Values, Int?>)] = [(.block, \.block), (.flight, \.flight)]
        for (field, kp) in durFields {
            guard let d = v[keyPath: kp] else { continue }
            for alt in variants(durText(d)) {
                guard let nd = ValueParsers.duration(alt) else { continue }
                var c = v
                c[keyPath: kp] = nd
                if c.isConsistent() { fixes.append(Fix(field: field, from: durText(d), to: alt, values: c)) }
            }
        }
        return fixes
    }
}

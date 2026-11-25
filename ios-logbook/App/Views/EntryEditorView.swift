import LogbookCore
import SwiftData
import SwiftUI

/// 기록 입력·수정 화면. 스캔 결과 확인 화면으로도 씀
struct EntryEditorView: View {
    @State var draft: EntryDraft
    let existing: FlightEntry?
    var onFinish: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Environment(SettingsStore.self) private var settings
    @Environment(\.airports) private var airports

    @State private var duplicate: FlightEntry?
    @State private var showImage = false

    private var isNew: Bool { existing == nil }

    var body: some View {
        Form {
            if draft.imageData != nil || !draft.notes.isEmpty { scanSection }
            if draft.record.isSimulator { simSections } else { flightSections }
            Section("비고") {
                TextField("메모", text: $draft.record.remarks, axis: .vertical)
            }
            if !isNew {
                Section {
                    Button("이 기록 삭제", role: .destructive) {
                        if let existing { context.delete(existing) }
                        try? context.save()
                        LocalBackup.snapshot(context, carry: settings.carryForward)
                        finish()
                    }
                }
            }
        }
        .navigationTitle(draft.record.isSimulator ? "시뮬레이터" : (isNew ? "새 비행" : draft.record.flightNumber))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("취소") { finish() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("저장") { save() }.disabled(!missing.isEmpty)
            }
        }
        .onChange(of: recalcInputs) { recalc() }
        .onChange(of: draft.role) { recalc() }
        .alert("같은 날짜에 같은 편명이 있습니다", isPresented: Binding(get: { duplicate != nil }, set: { if !$0 { duplicate = nil } })) {
            Button("기존 기록 업데이트") { if let d = duplicate { write(into: d) } }
            Button("새로 추가") { write(into: nil) }
            Button("취소", role: .cancel) {}
        } message: {
            Text("\(draft.record.logDate) \(draft.record.flightNumber)")
        }
        .sheet(isPresented: $showImage) {
            if let data = draft.imageData, let ui = UIImage(data: data) {
                NavigationStack {
                    ScrollView([.horizontal, .vertical]) { Image(uiImage: ui).resizable().scaledToFit().frame(minWidth: 600) }
                        .toolbar { Button("닫기") { showImage = false } }
                }
            }
        }
    }

    // MARK: 스캔 결과

    private var scanSection: some View {
        Section {
            HStack(alignment: .top, spacing: 16) {
                if let data = draft.imageData, let ui = UIImage(data: data) {
                    Button { showImage = true } label: {
                        Image(uiImage: ui).resizable().scaledToFit().frame(width: 120)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
                VStack(alignment: .leading, spacing: 6) {
                    let problems = draft.notes.filter { $0.kind == .missing || $0.kind == .mismatch || $0.kind == .unknownAirport }
                    if problems.isEmpty {
                        Label("BLOCK·FLIGHT 검산 통과", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                    } else {
                        Label("확인이 필요한 값이 있습니다", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    }
                    ForEach(draft.notes, id: \.self) { note in
                        Label(note.message, systemImage: icon(note.kind))
                            .font(.footnote)
                            .foregroundStyle(color(note.kind))
                    }
                    Text("사진과 아래 값을 한 번 비교한 뒤 저장하세요.").font(.footnote).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("스캔 결과")
        }
    }

    private func icon(_ k: ScanNote.Kind) -> String {
        switch k {
        case .missing: return "questionmark.circle"
        case .derived: return "function"
        case .corrected: return "wand.and.stars"
        case .guessed: return "text.magnifyingglass"
        case .mismatch: return "exclamationmark.triangle"
        case .unknownAirport: return "mappin.slash"
        }
    }

    private func color(_ k: ScanNote.Kind) -> Color {
        switch k {
        case .missing, .mismatch: return .red
        case .unknownAirport, .guessed, .corrected: return .orange
        case .derived: return .secondary
        }
    }

    private func flagged(_ field: OOOIField) -> Bool {
        draft.notes.contains { $0.field == field && $0.kind != .derived }
    }

    // MARK: 비행

    @ViewBuilder
    private var flightSections: some View {
        Section("비행") {
            LabeledContent("날짜") {
                if draft.record.outUTC != nil {
                    Text(LogDate.companyStyle(draft.record.logDate)).monospacedDigit()
                } else {
                    DatePicker("", selection: logDateBinding, displayedComponents: .date).labelsHidden()
                }
            }
            LabeledContent("편명") {
                TextField("OZ731", text: $draft.record.flightNumber)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .multilineTextAlignment(.trailing)
            }
            AirportField(title: "출발", icao: $draft.record.originICAO, flagged: flagged(.origin))
            AirportField(title: "도착", icao: $draft.record.destinationICAO, flagged: flagged(.destination))
            LabeledContent("기종") {
                TextField("A321", text: $draft.record.aircraftType)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent("등록부호 (HL)") {
                TextField("HL8399", text: $draft.record.registration)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .multilineTextAlignment(.trailing)
            }
            Picker("Duty", selection: $draft.record.duty) {
                ForEach(Duty.allCases, id: \.rawValue) { Text($0.label).tag($0.rawValue) }
            }
            LabeledContent("IRR") {
                TextField("비정상 운항 코드", text: $draft.record.irregular)
                    .textInputAutocapitalization(.characters)
                    .multilineTextAlignment(.trailing)
            }
        }

        Section {
            UTCTimeRow(title: "OUT", date: $draft.record.outUTC, flagged: flagged(.out)) { Date() }
            UTCTimeRow(title: "OFF", date: $draft.record.offUTC, flagged: flagged(.off)) {
                draft.record.outUTC?.addingTimeInterval(15 * 60) ?? Date()
            }
            UTCTimeRow(title: "ON", date: $draft.record.onUTC, flagged: flagged(.on)) {
                draft.record.offUTC?.addingTimeInterval(60 * 60) ?? Date()
            }
            UTCTimeRow(title: "IN", date: $draft.record.inUTC, flagged: flagged(.in)) {
                draft.record.onUTC?.addingTimeInterval(8 * 60) ?? Date()
            }
        } header: {
            Text("OOOI (UTC)")
        } footer: {
            Text("R/O = OUT, R/I = IN. 로그북 날짜는 OUT 시각의 \(settings.logTimeZoneID) 날짜로 정해집니다.")
        }

        Section {
            Picker("내가 한 이착륙", selection: $draft.role) {
                Text("선택").tag(PilotRole?.none)
                ForEach(PilotRole.allCases) { Text($0.label).tag(PilotRole?.some($0)) }
            }
            .pickerStyle(.menu)
            if draft.role == nil {
                Text("90일 이착륙 횟수에 들어가므로 꼭 골라 주세요.").font(.footnote).foregroundStyle(.orange)
            }
        } header: {
            Text("T/O · L/D")
        }

        Section {
            LabeledContent("Block (Duty time)", value: TimeText.hmm(draft.record.blockMinutes)).monospacedDigit()
            LabeledContent("Flight (T/S)", value: TimeText.hmm(draft.record.flightMinutes)).monospacedDigit()
            DurationField(title: "야간 (N/T)", minutes: $draft.record.nightMinutes, isManual: $draft.nightManual)
            DurationField(title: "계기 (I/T)", minutes: $draft.record.instrumentMinutes, isManual: $draft.instrumentManual)
            if draft.record.takeoffs + draft.record.landings > 0 {
                LabeledContent("야간 이착륙") {
                    Text("이륙 \(draft.record.nightTakeoffs) · 착륙 \(draft.record.nightLandings)")
                }
            }
        } header: {
            Text("시간")
        } footer: {
            if !missing.isEmpty {
                Text("저장하려면: " + missing.joined(separator: ", ")).foregroundStyle(.orange)
            } else if airports.airport(draft.record.originICAO) == nil || airports.airport(draft.record.destinationICAO) == nil {
                Text("공항 좌표가 없어 야간 시간을 계산하지 못했습니다. 설정 > 공항에서 추가하거나 직접 입력하세요.")
            } else {
                Text("야간은 \(settings.nightDefinition.label) 기준으로 항로를 따라 1분 단위로 계산합니다. 직접 고치면 그 값이 유지됩니다.")
            }
        }
    }

    // MARK: 시뮬레이터

    @ViewBuilder
    private var simSections: some View {
        Section("시뮬레이터") {
            DatePicker("날짜", selection: logDateBinding, displayedComponents: .date)
            LabeledContent("기종") {
                TextField("A320", text: $draft.record.aircraftType).multilineTextAlignment(.trailing)
            }
            LabeledContent("과목") {
                TextField("Recurrent 등", text: $draft.record.flightNumber).multilineTextAlignment(.trailing)
            }
            DurationField(title: "시간", minutes: $draft.record.blockMinutes, isManual: .constant(true), canReset: false)
        }
        Section("이착륙") {
            Stepper("이륙 \(draft.record.takeoffs)", value: $draft.record.takeoffs, in: 0...30)
            Stepper("착륙 \(draft.record.landings)", value: $draft.record.landings, in: 0...30)
            Stepper("그중 야간 이륙 \(draft.record.nightTakeoffs)", value: $draft.record.nightTakeoffs, in: 0...draft.record.takeoffs)
            Stepper("그중 야간 착륙 \(draft.record.nightLandings)", value: $draft.record.nightLandings, in: 0...draft.record.landings)
        }
    }

    private var logDateBinding: Binding<Date> {
        Binding(
            get: { LogDate.date(from: draft.record.logDate, in: settings.logTimeZone) ?? Date() },
            set: { draft.record.logDate = LogDate.string(for: $0, in: settings.logTimeZone) }
        )
    }

    // MARK: 계산·저장

    private struct RecalcInputs: Equatable {
        var out, off, on, inn: Date?
        var origin, destination: String
        var nightManual, instrumentManual: Bool
    }

    private var recalcInputs: RecalcInputs {
        RecalcInputs(out: draft.record.outUTC, off: draft.record.offUTC, on: draft.record.onUTC, inn: draft.record.inUTC,
                     origin: draft.record.originICAO, destination: draft.record.destinationICAO,
                     nightManual: draft.nightManual, instrumentManual: draft.instrumentManual)
    }

    private func recalc() {
        guard !draft.record.isSimulator else { return }
        // 이륙·착륙 횟수는 역할(PF/PM)이 정해져 있을 때만 다시 계산 (야간 여부가 시각에 따라 바뀌므로)
        let role = draft.role
        FlightCalculator.recalculate(&draft.record, airports: airports, options: settings.calcOptions,
                                     takeoff: role?.takeoff, landing: role?.landing,
                                     keepNight: draft.nightManual, keepInstrument: draft.instrumentManual)
    }

    private var missing: [String] {
        if draft.record.isSimulator { return draft.record.logDate.isEmpty ? ["날짜"] : [] }
        var m: [String] = []
        if draft.record.flightNumber.isEmpty { m.append("편명") }
        if draft.record.originICAO.isEmpty || draft.record.destinationICAO.isEmpty { m.append("출발·도착") }
        if draft.record.outUTC == nil || draft.record.inUTC == nil { m.append("OUT·IN 시각") }
        if let o = draft.record.outUTC, let i = draft.record.inUTC, i <= o { m.append("IN이 OUT보다 늦어야 함") }
        if draft.role == nil { m.append("T/O·L/D") }
        return m
    }

    private func save() {
        recalc()
        if isNew, !draft.record.isSimulator {
            let date = draft.record.logDate, flight = draft.record.flightNumber, id = draft.record.id
            let fd = FetchDescriptor<FlightEntry>(predicate: #Predicate { $0.logDate == date && $0.flightNumber == flight && $0.id != id })
            if let dup = try? context.fetch(fd).first {
                duplicate = dup
                return
            }
        }
        write(into: existing)
    }

    private func write(into target: FlightEntry?) {
        var r = draft.record
        r.updatedAt = Date()
        let entry: FlightEntry
        if let target {
            entry = target
            r.id = target.id
            r.createdAt = target.createdAt
            if r.registration.isEmpty { r.registration = target.registration }
        } else {
            entry = FlightEntry()
            r.createdAt = Date()
            context.insert(entry)
        }
        entry.apply(r)
        entry.nightManual = draft.nightManual
        entry.instrumentManual = draft.instrumentManual
        if let img = draft.imageData { entry.scanImage = img }
        try? context.save()
        LocalBackup.snapshot(context, carry: settings.carryForward)
        finish()
    }

    private func finish() {
        if let onFinish { onFinish() } else { dismiss() }
    }
}

// MARK: - 입력 부품

/// UTC 날짜·시각 입력 (24시간제)
struct UTCTimeRow: View {
    let title: String
    @Binding var date: Date?
    var flagged = false
    let suggestion: () -> Date

    var body: some View {
        HStack {
            Text(title).font(.body.monospaced().weight(.semibold)).frame(width: 52, alignment: .leading)
            if flagged { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
            Spacer()
            if let d = date {
                DatePicker("", selection: Binding(get: { d }, set: { date = $0 }),
                           displayedComponents: [.date, .hourAndMinute])
                    .labelsHidden()
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                    .environment(\.locale, Locale(identifier: "en_GB"))
                Text("Z").foregroundStyle(.secondary)
                Button { date = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                    .buttonStyle(.borderless)
            } else {
                Button("입력") { date = suggestion() }.buttonStyle(.borderless)
            }
        }
    }
}

/// "5:45" 형식 시간 입력. 고치면 직접 입력(수동) 상태가 되고, 자동 계산으로 되돌릴 수 있음
struct DurationField: View {
    let title: String
    @Binding var minutes: Int
    @Binding var isManual: Bool
    var canReset = true

    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        LabeledContent(title) {
            HStack {
                if isManual, canReset {
                    Button("자동") { isManual = false }.buttonStyle(.borderless).font(.footnote)
                }
                TextField("0:00", text: $text)
                    .keyboardType(.numbersAndPunctuation)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .frame(maxWidth: 90)
                    .focused($focused)
                    .onSubmit(commit)
            }
        }
        .onAppear { text = TimeText.hmm(minutes) }
        .onChange(of: minutes) { _, m in if !focused { text = TimeText.hmm(m) } }
        .onChange(of: focused) { _, f in if !f { commit() } }
    }

    private func commit() {
        guard let m = TimeText.parseHMM(text) else { text = TimeText.hmm(minutes); return }
        if m != minutes {
            minutes = m
            isManual = true
        }
        text = TimeText.hmm(m)
    }
}

/// 공항 입력: ICAO(RKSI)나 IATA(ICN) 아무거나 넣으면 ICAO로 저장
struct AirportField: View {
    let title: String
    @Binding var icao: String
    var flagged = false
    @Environment(\.airports) private var airports
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        LabeledContent {
            HStack {
                if let a = airports.airport(icao), !focused {
                    Text(a.iata).foregroundStyle(.secondary)
                }
                TextField("ICN / RKSI", text: $text)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 120)
                    .focused($focused)
                    .onSubmit(commit)
            }
        } label: {
            HStack {
                Text(title)
                if flagged { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
            }
        }
        .onAppear { text = icao }
        .onChange(of: icao) { _, v in if !focused { text = v } }
        .onChange(of: focused) { _, f in if !f { commit() } }
    }

    private func commit() {
        let code = text.uppercased().trimmingCharacters(in: .whitespaces)
        icao = airports.airport(code)?.icao ?? code
        text = icao
    }
}

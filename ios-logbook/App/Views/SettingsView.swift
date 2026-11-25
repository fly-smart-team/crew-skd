import LogbookCore
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(SettingsStore.self) private var settings
    @Environment(\.modelContext) private var context
    @Query(sort: \CustomAirport.icao) private var customAirports: [CustomAirport]
    @Query private var entries: [FlightEntry]

    @State private var exportFile: ExportFile?
    @State private var exportType: UTType = .json
    @State private var exportName = ""
    @State private var showExporter = false
    @State private var showImporter = false
    @State private var message: String?
    @State private var showAddAirport = false

    var body: some View {
        @Bindable var settings = settings
        NavigationStack {
            Form {
                Section {
                    LabeledContent("iCloud 동기화") {
                        if FileManager.default.ubiquityIdentityToken != nil {
                            Label("켜짐", systemImage: "icloud.fill").foregroundStyle(.green)
                        } else {
                            Label("iCloud 로그인 필요", systemImage: "icloud.slash").foregroundStyle(.orange)
                        }
                    }
                    Button("JSON 전체 백업 내보내기", systemImage: "square.and.arrow.up") { exportJSON() }
                    Button("CSV 내보내기 (회사 Flight Log 칸 순서)", systemImage: "tablecells") { exportCSV() }
                    Button("백업 파일에서 불러오기", systemImage: "square.and.arrow.down") { showImporter = true }
                } header: {
                    Text("저장 · 백업")
                } footer: {
                    Text("""
                    • 기록은 항상 이 iPad에 먼저 저장됩니다 (비행기 모드에서도 OK).
                    • iCloud에 로그인돼 있으면 인터넷이 될 때 자동으로 iCloud에 올라가고 다른 Apple 기기와 맞춰집니다.
                    • 구글 드라이브: 내보내기 후 저장 위치에서 'Google Drive'를 고르세요 (Google Drive 앱 설치 필요).
                    • 저장할 때마다 '파일 앱 › 나의 iPad › 로그북 › Backups'에 JSON 사본이 자동으로 남습니다 (최근 \(LocalBackup.keep)일).
                    """)
                }

                Section {
                    DurationField(title: "총 비행시간", minutes: $settings.carryForward.totalMinutes,
                                  isManual: .constant(true), canReset: false)
                    DurationField(title: "기장(CAP) 시간", minutes: $settings.carryForward.picMinutes,
                                  isManual: .constant(true), canReset: false)
                    DurationField(title: "야간", minutes: $settings.carryForward.nightMinutes,
                                  isManual: .constant(true), canReset: false)
                    DurationField(title: "계기", minutes: $settings.carryForward.instrumentMinutes,
                                  isManual: .constant(true), canReset: false)
                    DatePicker("기준일 (이날까지 포함)", selection: Binding(
                        get: { LogDate.date(from: settings.carryForward.asOfDate, in: settings.logTimeZone) ?? Date() },
                        set: { settings.carryForward.asOfDate = LogDate.string(for: $0, in: settings.logTimeZone) }
                    ), displayedComponents: .date)
                } header: {
                    Text("이월 누계")
                } footer: {
                    Text("회사 Flight Log의 Flight Summary 숫자를 넣으세요. 기준일 이후의 앱 기록만 더해집니다. (시:분, 예 8584:14)")
                }

                Section("기본값 · 계산 규칙") {
                    LabeledContent("기본 기종") {
                        TextField("A321", text: $settings.defaultAircraftType)
                            .textInputAutocapitalization(.characters).multilineTextAlignment(.trailing)
                    }
                    Picker("기본 Duty", selection: $settings.defaultDuty) {
                        ForEach(Duty.allCases, id: \.rawValue) { Text($0.label).tag($0.rawValue) }
                    }
                    Picker("로그북 날짜 기준", selection: $settings.logTimeZoneID) {
                        Text("한국 시간 (회사 로그북과 같음)").tag("Asia/Seoul")
                        Text("UTC").tag("UTC")
                    }
                    Picker("야간 기준", selection: $settings.nightDefinition) {
                        ForEach(NightDefinition.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    Picker("계기 시간", selection: $settings.instrumentRule) {
                        ForEach(InstrumentRule.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                }

                Section {
                    ForEach(customAirports) { a in
                        LabeledContent("\(a.icao) / \(a.iata)", value: a.timeZoneID)
                    }
                    .onDelete { idx in
                        for i in idx { context.delete(customAirports[i]) }
                    }
                    Button("공항 추가", systemImage: "plus") { showAddAirport = true }
                } header: {
                    Text("공항")
                } footer: {
                    Text("기본으로 한국·일본·중국·동남아 주요 공항 \(AirportDatabase.standard.all.count)곳이 들어 있습니다. 없는 공항은 좌표와 시간대를 추가하면 야간 시간이 계산됩니다.")
                }
            }
            .navigationTitle("설정")
            .fileExporter(isPresented: $showExporter, document: exportFile, contentType: exportType,
                          defaultFilename: exportName) { result in
                if case .failure(let e) = result { message = "내보내기 실패: \(e.localizedDescription)" }
            }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
                switch result {
                case .success(let url):
                    do {
                        let plan = try BackupImporter.importBackup(from: url, context: context, settings: settings)
                        message = "추가 \(plan.insert.count)건, 갱신 \(plan.update.count)건, 변경 없음 \(plan.unchanged)건"
                        LocalBackup.snapshot(context, carry: settings.carryForward)
                    } catch {
                        message = "불러오기 실패: \(error.localizedDescription)"
                    }
                case .failure(let e):
                    message = "불러오기 실패: \(e.localizedDescription)"
                }
            }
            .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("확인") {}
            }
            .sheet(isPresented: $showAddAirport) { AddAirportView() }
        }
    }

    private var today: String { LogDate.string(for: Date(), in: settings.logTimeZone) }

    private func exportJSON() {
        do {
            let data = try LogbookBackup(carryForward: settings.carryForward, entries: entries.map(\.record)).encoded()
            exportFile = ExportFile(data: data)
            exportType = .json
            exportName = "logbook-backup-\(today).json"
            showExporter = true
        } catch {
            message = "백업 만들기 실패: \(error.localizedDescription)"
        }
    }

    private func exportCSV() {
        let csv = CompanyCSV.make(entries.map(\.record), airports: AirportDatabase.standard.adding(customAirports.map(\.airport)))
        exportFile = ExportFile(data: Data(csv.utf8))
        exportType = .commaSeparatedText
        exportName = "logbook-\(today).csv"
        showExporter = true
    }
}

struct AddAirportView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @State private var icao = ""
    @State private var iata = ""
    @State private var lat = ""
    @State private var lon = ""
    @State private var tz = "Asia/Seoul"

    private var valid: Bool {
        icao.count == 4 && Double(lat) != nil && Double(lon) != nil && TimeZone(identifier: tz) != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("ICAO (4자, 예 RKSI)", text: $icao).textInputAutocapitalization(.characters)
                TextField("IATA (3자, 예 ICN)", text: $iata).textInputAutocapitalization(.characters)
                TextField("위도 (예 37.4602)", text: $lat).keyboardType(.numbersAndPunctuation)
                TextField("경도 (예 126.4407)", text: $lon).keyboardType(.numbersAndPunctuation)
                Picker("시간대", selection: $tz) {
                    ForEach(TimeZone.knownTimeZoneIdentifiers.sorted(), id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.navigationLink)
            }
            .navigationTitle("공항 추가")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("추가") {
                        context.insert(CustomAirport(icao: icao.uppercased(), iata: iata.uppercased(),
                                                     latitude: Double(lat)!, longitude: Double(lon)!, timeZoneID: tz))
                        try? context.save()
                        dismiss()
                    }
                    .disabled(!valid)
                }
            }
        }
    }
}

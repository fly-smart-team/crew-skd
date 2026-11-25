import LogbookCore
import SwiftData
import SwiftUI

struct LogListView: View {
    @Environment(\.modelContext) private var context
    @Environment(SettingsStore.self) private var settings
    @Environment(\.airports) private var airports
    @Query(sort: [SortDescriptor(\FlightEntry.logDate, order: .reverse),
                  SortDescriptor(\FlightEntry.createdAt, order: .reverse)])
    private var entries: [FlightEntry]

    @State private var showScan = false
    @State private var newDraft: EntryDraft?
    @State private var editing: FlightEntry?
    @State private var search = ""

    private var filtered: [FlightEntry] {
        guard !search.isEmpty else { return entries }
        let q = search.uppercased()
        return entries.filter {
            $0.flightNumber.uppercased().contains(q) || $0.registration.uppercased().contains(q)
                || airports.displayCode($0.originICAO).contains(q) || airports.displayCode($0.destinationICAO).contains(q)
                || $0.logDate.contains(search)
        }
    }

    private var months: [(String, [FlightEntry])] {
        Dictionary(grouping: filtered) { String($0.logDate.prefix(7)) }
            .sorted { $0.key > $1.key }
    }

    var body: some View {
        NavigationStack {
            List {
                if entries.isEmpty {
                    ContentUnavailableView {
                        Label("기록이 없습니다", systemImage: "airplane")
                    } description: {
                        Text("ACARS OOOI STATUS 화면을 찍으면 시각이 자동으로 들어갑니다.")
                    } actions: {
                        Button("OOOI 화면 스캔") { showScan = true }.buttonStyle(.borderedProminent)
                    }
                }
                ForEach(months, id: \.0) { month, items in
                    Section {
                        ForEach(items) { e in
                            Button { editing = e } label: { LogRow(entry: e) }
                                .buttonStyle(.plain)
                        }
                        .onDelete { idx in delete(idx.map { items[$0] }) }
                    } header: {
                        HStack {
                            Text(month.replacingOccurrences(of: "-", with: "년 ") + "월")
                            Spacer()
                            Text(TimeText.hmm(items.filter { !$0.isSimulator }.reduce(0) { $0 + $1.blockMinutes }))
                                .monospacedDigit()
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "편명, 등록부호, 공항, 날짜")
            .navigationTitle("로그북")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Menu {
                        Button("비행 직접 입력", systemImage: "square.and.pencil") {
                            newDraft = EntryDraft.new(settings: settings, last: entries.first { !$0.isSimulator })
                        }
                        Button("시뮬레이터 기록", systemImage: "desktopcomputer") {
                            var d = EntryDraft.new(settings: settings, last: nil)
                            d.record.isSimulator = true
                            d.record.aircraftType = settings.defaultAircraftType
                            d.record.source = "manual"
                            newDraft = d
                        }
                    } label: {
                        Label("추가", systemImage: "plus")
                    }
                    Button { showScan = true } label: {
                        Label("OOOI 스캔", systemImage: "camera.viewfinder")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .sheet(isPresented: $showScan) {
                ScanView(last: entries.first { !$0.isSimulator })
            }
            .sheet(item: $editing) { e in
                NavigationStack { EntryEditorView(draft: .editing(e), existing: e) }
            }
            .sheet(isPresented: Binding(get: { newDraft != nil }, set: { if !$0 { newDraft = nil } })) {
                if let d = newDraft {
                    NavigationStack { EntryEditorView(draft: d, existing: nil) }
                }
            }
        }
    }

    private func delete(_ items: [FlightEntry]) {
        for e in items { context.delete(e) }
        try? context.save()
        LocalBackup.snapshot(context, carry: settings.carryForward)
    }
}

struct LogRow: View {
    let entry: FlightEntry
    @Environment(\.airports) private var airports

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(entry.logDate.suffix(5).replacingOccurrences(of: "-", with: "/"))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 48, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                if entry.isSimulator {
                    Text("SIM · \(entry.aircraftType)").font(.headline)
                } else {
                    Text("\(entry.flightNumber)  \(airports.displayCode(entry.originICAO))→\(airports.displayCode(entry.destinationICAO))")
                        .font(.headline)
                }
                Text([entry.aircraftType, entry.registration, entry.duty].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            HStack(spacing: 6) {
                if entry.takeoffs > 0 { Badge(text: entry.nightTakeoffs > 0 ? "T/O☾" : "T/O") }
                if entry.landings > 0 { Badge(text: entry.nightLandings > 0 ? "L/D☾" : "L/D") }
                if entry.scanImage != nil { Image(systemName: "camera.fill").font(.caption2).foregroundStyle(.secondary) }
            }
            VStack(alignment: .trailing, spacing: 2) {
                Text(TimeText.hmm(entry.blockMinutes)).font(.headline.monospacedDigit())
                if entry.nightMinutes > 0 {
                    Text("☾ " + TimeText.hmm(entry.nightMinutes)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            .frame(minWidth: 56, alignment: .trailing)
        }
        .contentShape(Rectangle())
    }
}

struct Badge: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.tint.opacity(0.15), in: Capsule())
    }
}

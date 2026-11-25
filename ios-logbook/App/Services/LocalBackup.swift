import Foundation
import LogbookCore
import SwiftData
import UniformTypeIdentifiers
import SwiftUI

/// 저장할 때마다 이 iPad의 "파일 앱 > 나의 iPad > 로그북 > Backups"에 JSON 사본을 남깁니다.
/// iCloud가 꺼져 있거나 동기화가 꼬여도 오프라인 사본이 남도록 하는 안전장치입니다.
enum LocalBackup {
    static let keep = 30

    static var folder: URL {
        URL.documentsDirectory.appending(path: "Backups", directoryHint: .isDirectory)
    }

    @MainActor
    static func snapshot(_ context: ModelContext, carry: CarryForward) {
        do {
            let entries = try context.fetch(FetchDescriptor<FlightEntry>()).map(\.record)
            let data = try LogbookBackup(carryForward: carry, entries: entries).encoded()
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let day = LogDate.string(for: Date(), in: .current)
            try data.write(to: folder.appending(path: "logbook-\(day).json"), options: .atomic)
            try data.write(to: folder.appending(path: "logbook-latest.json"), options: .atomic)
            prune()
        } catch {
            print("자동 백업 실패: \(error)")
        }
    }

    private static func prune() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) else { return }
        let dated = files.filter { $0.lastPathComponent.hasPrefix("logbook-20") }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
        for old in dated.dropFirst(keep) { try? fm.removeItem(at: old) }
    }
}

/// 내보내기용 파일 (JSON 백업 또는 CSV)
struct ExportFile: FileDocument {
    static var readableContentTypes: [UTType] { [.json, .commaSeparatedText] }
    var data: Data

    init(data: Data) { self.data = data }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

enum BackupImporter {
    /// JSON 백업을 현재 기록에 합침. 같은 기록이면 더 나중에 고친 쪽을 남김
    @MainActor
    static func importBackup(from url: URL, context: ModelContext, settings: SettingsStore) throws -> BackupMerge.Plan {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let backup = try LogbookBackup.decode(Data(contentsOf: url))

        let existing = try context.fetch(FetchDescriptor<FlightEntry>())
        let plan = BackupMerge.plan(existing: existing.map(\.record), incoming: backup.entries)
        for r in plan.update {
            existing.first { $0.id == r.id }?.apply(r)
        }
        for r in plan.insert {
            let e = FlightEntry()
            e.apply(r)
            context.insert(e)
        }
        if let carry = backup.carryForward, settings.carryForward == CarryForward() {
            settings.carryForward = carry
        }
        try context.save()
        return plan
    }
}

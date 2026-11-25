import LogbookCore
import PhotosUI
import SwiftData
import SwiftUI

/// OOOI 화면 사진 → 자동 입력 → 확인·수정 화면
struct ScanView: View {
    let last: FlightEntry?

    @Environment(\.dismiss) private var dismiss
    @Environment(SettingsStore.self) private var settings
    @Environment(\.airports) private var airports

    @State private var showCamera = false
    @State private var pickerItem: PhotosPickerItem?
    @State private var working = false
    @State private var error: String?
    @State private var draft: EntryDraft?

    var body: some View {
        NavigationStack {
            if let draft {
                EntryEditorView(draft: draft, existing: nil, onFinish: { dismiss() })
            } else {
                chooser
            }
        }
    }

    private var chooser: some View {
        VStack(spacing: 24) {
            Image(systemName: "camera.viewfinder").font(.system(size: 64)).foregroundStyle(.tint)
            VStack(spacing: 8) {
                Text("AOC OOOI STATUS 화면을 찍어 주세요").font(.title3.bold())
                Text("화면을 정면에서, 반사가 적게, 오른쪽 끝(OFF·ON 값)까지 들어오게 찍으면 정확합니다.\n못 읽은 값은 BLOCK·FLIGHT 값으로 계산해서 채웁니다.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            if working {
                ProgressView("읽는 중…")
            } else {
                VStack(spacing: 12) {
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button { showCamera = true } label: {
                            Label("카메라로 찍기", systemImage: "camera").frame(maxWidth: 320)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                    }
                    PhotosPicker(selection: $pickerItem, matching: .images) {
                        Label("사진 보관함에서 고르기", systemImage: "photo.on.rectangle").frame(maxWidth: 320)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }
            }
            if let error {
                Text(error).foregroundStyle(.red).multilineTextAlignment(.center)
            }
        }
        .padding(32)
        .navigationTitle("OOOI 스캔")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                showCamera = false
                if let image { process(image, captureDate: Date()) }
            }
            .ignoresSafeArea()
        }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                    error = "사진을 불러오지 못했습니다."
                    return
                }
                process(image, captureDate: ImageMetadata.captureDate(from: data))
            }
        }
    }

    private func process(_ image: UIImage, captureDate: Date?) {
        working = true
        error = nil
        Task {
            defer { working = false }
            do {
                let d = try await ScanPipeline.run(image: image, captureDate: captureDate, settings: settings,
                                                   airports: airports, last: last)
                if !d.isOOOIPage && d.record.outUTC == nil {
                    error = "OOOI STATUS 화면을 찾지 못했습니다. 다시 찍어 주세요."
                    return
                }
                draft = d
            } catch {
                self.error = "글자 인식 실패: \(error.localizedDescription)"
            }
        }
    }
}

/// 카메라 (UIImagePickerController)
struct CameraPicker: UIViewControllerRepresentable {
    let onFinish: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: (UIImage?) -> Void
        init(onFinish: @escaping (UIImage?) -> Void) { self.onFinish = onFinish }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onFinish(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onFinish(nil) }
    }
}

import SwiftUI
import UIKit

/// Home: the list of saved scans and a New scan button.
struct RootView: View {
    let library: CaptureLibrary

    @State private var path: [UUID] = []
    @State private var isCapturing = false

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationTitle("Scans")
                .safeAreaInset(edge: .bottom) { newScanButton }
                .navigationDestination(for: UUID.self) { id in
                    CaptureDetailView(library: library, captureID: id) {
                        path.removeAll { $0 == id }
                    }
                }
        }
        .task { await library.refresh() }
        .refreshable { await library.refresh() }
        .fullScreenCover(isPresented: $isCapturing, onDismiss: refreshLibrary) {
            CaptureFlowView(library: library) { id in
                path = [id]
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if library.captures.isEmpty && !library.isLoading {
            ContentUnavailableView {
                Label("No scans yet", systemImage: "camera.viewfinder")
            } description: {
                Text("Walk a room slowly with the phone held steady. Each scan is saved on this \(CaptureDevice.name) as an Echo-3 capture bundle.")
            }
        } else {
            List {
                ForEach(library.captures) { record in
                    NavigationLink(value: record.id) {
                        CaptureRowView(record: record)
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    private var newScanButton: some View {
        Button {
            isCapturing = true
        } label: {
            Label("New scan", systemImage: "camera.fill")
        }
        .buttonStyle(PrimaryActionButtonStyle())
        .disabled(!ARCaptureCoordinator.isWorldTrackingSupported)
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
        .readableColumn(maxWidth: 440)
        .accessibilityIdentifier("new-scan")
    }

    private func refreshLibrary() {
        Task { await library.refresh() }
    }
}

struct CaptureRowView: View {
    let record: CaptureRecord

    var body: some View {
        HStack(spacing: 12) {
            thumbnail
            VStack(alignment: .leading, spacing: 3) {
                Text(record.name)
                    .font(.headline)
                    .lineLimit(1)
                Text("\(record.formattedDate), \(record.formattedTime)")
                    .font(.subheadline)
                    .foregroundStyle(Theme.mutedForeground)
                Text("\(record.frameCount) frames · \(record.formattedDuration) · \(record.formattedStorageSize)")
                    .font(.caption)
                    .foregroundStyle(Theme.mutedForeground)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let url = record.thumbnailURL, let image = UIImage(contentsOfFile: url.path) {
            CaptureThumbnailImage(image: Image(uiImage: image))
                .frame(width: 56, height: 56)
                .background(Color(white: 0.08))
                .clipShape(RoundedRectangle(cornerRadius: 10))
        } else {
            RoundedRectangle(cornerRadius: 10)
                .fill(Theme.muted)
                .frame(width: 56, height: 56)
                .overlay {
                    Image(systemName: "cube.transparent")
                        .foregroundStyle(Theme.mutedForeground)
                }
        }
    }
}

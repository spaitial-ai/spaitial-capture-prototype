import SwiftUI
import UIKit

/// One saved scan: summary, on-device contract validation, bundle contents,
/// zip export, rename and delete.
struct CaptureDetailView: View {
    let library: CaptureLibrary
    let captureID: UUID
    let onDeleted: () -> Void

    @State private var validation: CaptureValidationResult?
    @State private var contents: [BundleEntry] = []
    @State private var exportedZip: URL?
    @State private var isExporting = false
    @State private var errorMessage: String?
    @State private var isRenaming = false
    @State private var isConfirmingDelete = false

    var body: some View {
        Group {
            if let record = library.record(for: captureID) {
                list(for: record)
                    .task(id: record.id) { await inspect(record) }
            } else {
                ContentUnavailableView("Scan not found", systemImage: "questionmark.folder")
            }
        }
        .navigationTitle(library.record(for: captureID)?.name ?? "Scan")
        .navigationBarTitleDisplayMode(.inline)
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
        .sheet(isPresented: $isRenaming) {
            CaptureRenameSheet(
                initialName: library.record(for: captureID)?.name ?? "",
                onSave: rename
            )
        }
        .confirmationDialog(
            "Delete this scan?",
            isPresented: $isConfirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete scan", role: .destructive, action: delete)
        } message: {
            Text("The bundle is removed from this \(CaptureDevice.name).")
        }
    }

    private func list(for record: CaptureRecord) -> some View {
        List {
            Section {
                summaryRow("Frames", "\(record.frameCount)")
                summaryRow("Duration", record.formattedDuration)
                summaryRow("Path length", String(format: "%.1f m", record.pathLengthM))
                summaryRow("Bundle size", record.formattedBundleSize)
                summaryRow("Recorded", "\(record.formattedDate), \(record.formattedTime)")
            }

            Section {
                validationRow
            } header: {
                Text("Bundle contract")
            } footer: {
                Text("Checks file names, image size, EXIF capture times, pose matrices and intrinsics against the Echo-3 capture contract.")
            }

            Section("Contents") {
                ForEach(contents) { entry in
                    HStack {
                        Label(entry.name, systemImage: entry.symbol)
                        Spacer()
                        Text(entry.detail)
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(Theme.mutedForeground)
                    }
                }
            }

            Section {
                exportRow(for: record)
                Button("Rename") { isRenaming = true }
                Button("Delete scan", role: .destructive) { isConfirmingDelete = true }
            } footer: {
                Text("The bundle is also visible in the Files app under On My \(CaptureDevice.name) › Capture › Captures › \(record.id.uuidString) › bundle.")
            }
        }
    }

    private func summaryRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(value)
                .monospacedDigit()
                .foregroundStyle(Theme.mutedForeground)
        }
    }

    @ViewBuilder
    private var validationRow: some View {
        if let validation {
            if validation.isValid {
                Label("Valid bundle", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(Theme.success)
            } else {
                ForEach(validation.issues, id: \.self) { issue in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(issue.code)
                            .font(.caption.monospaced())
                            .foregroundStyle(Theme.destructive)
                        Text(issue.message).font(.footnote)
                    }
                }
            }
        } else {
            HStack(spacing: 8) {
                ProgressView()
                Text("Validating…").foregroundStyle(Theme.mutedForeground)
            }
        }
    }

    @ViewBuilder
    private func exportRow(for record: CaptureRecord) -> some View {
        if let exportedZip {
            ShareLink(item: exportedZip) {
                Label("Share \(exportedZip.lastPathComponent)", systemImage: "square.and.arrow.up")
            }
        } else {
            Button {
                export(record)
            } label: {
                HStack {
                    Label("Export bundle as zip", systemImage: "doc.zipper")
                    if isExporting {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(isExporting)
            .accessibilityIdentifier("export-bundle")
        }
    }

    private func inspect(_ record: CaptureRecord) async {
        let bundleURL = record.bundleURL
        let frameCount = record.frameCount
        let (result, entries) = await Task.detached(priority: .userInitiated) {
            (
                CaptureBundleValidator.validateBundle(at: bundleURL, frameCount: frameCount),
                BundleEntry.list(bundleRoot: bundleURL)
            )
        }.value
        validation = result
        contents = entries
    }

    private func export(_ record: CaptureRecord) {
        isExporting = true
        Task {
            let result = await Task.detached(priority: .userInitiated) {
                Result { try CaptureBundleExporter.makeZip(for: record) }
            }.value
            isExporting = false
            switch result {
            case let .success(url): exportedZip = url
            case let .failure(error): errorMessage = error.localizedDescription
            }
        }
    }

    private func rename(to newName: String) -> String? {
        do {
            try library.rename(id: captureID, to: newName)
            exportedZip = nil
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    private func delete() {
        do {
            try library.deleteFiles(id: captureID)
            onDeleted()
            Task {
                // Let the navigation pop finish before the list row disappears.
                try? await Task.sleep(for: .milliseconds(450))
                library.removeRecord(id: captureID)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// One top-level folder (or file) inside `bundle/`.
struct BundleEntry: Identifiable, Sendable {
    let name: String
    let fileCount: Int
    let bytes: Int64
    let isDirectory: Bool

    var id: String { name }

    var symbol: String { isDirectory ? "folder" : "doc" }

    var detail: String {
        let size = CaptureFormatting.byteCount(bytes)
        return isDirectory ? "\(fileCount) files · \(size)" : size
    }

    static func list(bundleRoot: URL, fileManager: FileManager = .default) -> [BundleEntry] {
        let children = (try? fileManager.contentsOfDirectory(
            at: bundleRoot,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        return children
            .map { url in
                let isDirectory =
                    (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
                let files = isDirectory
                    ? ((try? fileManager.contentsOfDirectory(atPath: url.path))?.count ?? 0)
                    : 1
                return BundleEntry(
                    name: url.lastPathComponent,
                    fileCount: files,
                    bytes: CaptureStorageMetrics.itemSize(at: url, fileManager: fileManager),
                    isDirectory: isDirectory
                )
            }
            .sorted { $0.name < $1.name }
    }
}

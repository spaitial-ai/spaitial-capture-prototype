import SwiftUI

/// Full-screen capture flow: readiness → live → saving → saved.
struct CaptureFlowView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    @State private var model: CaptureFlowModel
    @State private var isRenaming = false

    private let library: CaptureLibrary
    private let onShowCaptureDetails: (UUID) -> Void

    init(library: CaptureLibrary, onShowCaptureDetails: @escaping (UUID) -> Void) {
        self.library = library
        self.onShowCaptureDetails = onShowCaptureDetails
        _model = State(
            initialValue: CaptureFlowModel(
                library: library,
                experience: CaptureGuidanceSetup.makeExperience()
            )
        )
    }

    var body: some View {
        ZStack {
            switch model.step {
            case .readiness:
                CaptureReadinessView(model: model, onCancel: close)
            case .live:
                if let experience = model.experience {
                    experience.liveView()
                } else {
                    LiveCaptureView(model: model)
                }
            case .saving:
                SavingLocallyView(model: model)
            case .saved:
                CaptureSavedView(
                    model: model,
                    onDone: close,
                    onShowDetails: showDetails,
                    onRename: { isRenaming = true }
                )
            }
        }
        .overlay { model.experience?.flowOverlay() }
        .task { await model.onAppear() }
        .onDisappear {
            model.onDisappear()
            CaptureOrientationLock.endCapturePresentation()
        }
        .onChange(of: scenePhase) { _, phase in
            model.handleScenePhase(phase)
        }
        .confirmationDialog(
            "Discard this scan?",
            isPresented: $model.showDiscardConfirmation,
            titleVisibility: .visible
        ) {
            Button("Discard scan", role: .destructive) {
                model.confirmDiscard(dismiss: close)
            }
            Button("Keep scanning", role: .cancel) {}
        } message: {
            Text("It hasn't been saved and can't be recovered.")
        }
        .fullScreenCover(isPresented: $model.showFinishSheet, onDismiss: resumeAfterSheetDismiss) {
            CaptureCenteredSheet { FinishCaptureSheet(model: model) }
                .presentationBackground(.clear)
                .interactiveDismissDisabled(model.hasReachedFrameLimit)
        }
        .sheet(isPresented: $isRenaming) {
            CaptureRenameSheet(
                initialName: model.savedRecord?.name ?? model.captureName,
                onSave: rename
            )
        }
    }

    private func close() {
        dismiss()
    }

    private func showDetails() {
        guard let id = model.savedRecord?.id else { return }
        onShowCaptureDetails(id)
        dismiss()
    }

    private func resumeAfterSheetDismiss() {
        if model.step == .live {
            model.keepCapturing()
        }
    }

    private func rename(to newName: String) -> String? {
        guard let id = model.savedRecord?.id else {
            return "This scan is no longer available."
        }
        do {
            try library.rename(id: id, to: newName)
            if var saved = model.savedRecord {
                saved.name = newName
                model.savedRecord = saved
            }
            return nil
        } catch {
            return error.localizedDescription
        }
    }
}

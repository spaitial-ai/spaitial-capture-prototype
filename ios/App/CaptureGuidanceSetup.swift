/// Chooses the guidance setup at build time (see `docs/guidance-setups.md`).
///
/// - Core (`CapturePrototype` target): text coaching and a scan-pass guide on
///   any ARKit iPhone. No add-on.
/// - Full (`CapturePrototypeFull` target, `FULL_GUIDANCE` flag): adds the
///   LiDAR coverage mesh, gap coaching, walkthrough and finish review from
///   `FullGuidance/`.
///
/// To port core only, delete `FullGuidance/` and this `#if` branch.
@MainActor
enum CaptureGuidanceSetup {
    static func makeExperience() -> (any CaptureGuidanceExperience)? {
        #if FULL_GUIDANCE
        CoverageGuidanceExperience()
        #else
        nil
        #endif
    }
}

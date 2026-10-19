import { MotionGlobalConfig } from "motion";

// Tests only assert end states, so let Motion jump there instead of animating.
MotionGlobalConfig.skipAnimations = true;

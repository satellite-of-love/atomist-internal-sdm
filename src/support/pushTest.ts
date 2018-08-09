import { PredicatePushTest } from "@atomist/sdm/api/mapping/PushTest";
import {
    hasFile,
    hasFileWithExtension,
} from "@atomist/sdm/api/mapping/support/commonPushTests";

export const IsClojure: PredicatePushTest = hasFileWithExtension("clj");
export const IsLein = hasFile("project.clj");

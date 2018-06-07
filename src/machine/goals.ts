/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// GOAL Definition

import {
    Goal,
    Goals,
    GoalWithPrecondition,
    IndependentOfEnvironment,
    ProductionEnvironment,
    StagingEnvironment,
    BuildGoal,
    ReviewGoal,
    AutofixGoal,
} from "@atomist/sdm";
import {
    DockerBuildGoal,
    TagGoal,
    VersionGoal,
} from "@atomist/sdm/goal/common/commonGoals";


// GOALSET Definition

export const PublishGoal = new GoalWithPrecondition({
    uniqueName: "Publish",
    environment: IndependentOfEnvironment,
    orderedName: "2-publish",
    displayName: "publish",
    workingDescription: "Publishing...",
    completedDescription: "Published",
    failedDescription: "Published failed",
    isolated: true,
}, BuildGoal);

// Just running review and autofix
export const CheckGoals = new Goals(
    "Check",
    VersionGoal,
    ReviewGoal,
    AutofixGoal,
);

// Build including docker build

export const LibraryPublished = new Goal({
    uniqueName: "LibraryPublished",
    environment: ProductionEnvironment,
    orderedName: "3-prod-library-published",
    displayName: "publish library",
    completedDescription: "Library Published",
});

export const LeinBuildGoals = new Goals(
    "Lein Build",
    ...CheckGoals.goals,
    BuildGoal,
    TagGoal,
    // new GoalWithPrecondition(LibraryPublished.definition, TagGoal),
);

export const LeinDockerGoals = new Goals(
    "hackLein Docker Build",
    ...LeinBuildGoals.goals,
    DockerBuildGoal,
);

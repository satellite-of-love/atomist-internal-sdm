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

import { HandlerContext } from "@atomist/automation-client";
import { SimpleRepoId } from "@atomist/automation-client/operations/common/RepoId";
import { InMemoryProject } from "@atomist/automation-client/project/mem/InMemoryProject";
import * as fs from "fs";
import * as assert from "power-assert";
import { addCacheHooks, updateK8Spec } from "../src/machine/leinSupport";

describe("updateK8Specs", () => {

    it("updates the docker image version", done => {
        const pochtaSpec = "80-pochta-deployment.json";
        const inProject = `us-east-1c/${pochtaSpec}`;
        fs.readFile(`test/${pochtaSpec}`, async (_, c) => {
            const contents = c.toString();
            const version = "1.2.3-123123123";
            const p = InMemoryProject.from(new SimpleRepoId("atomisthq", "pochta"),
                { path: inProject, content: contents });
            await updateK8Spec(p, {
                teamId: "",
                correlationId: "",
                graphClient: {
                    endpoint: null,
                    query: null,
                    mutate: null,
                    executeQuery: null,
                    executeMutationFromFile: null,
                    executeMutation: null,
                    executeQueryFromFile: (q, v) => {
                        return { commits: [{ sha: "" }] } as any;
                    },
                },
                messageClient: {
                    respond: null,
                    send: (a, b) => null,
                    addressUsers: null,
                    addressChannels: null,
                },
            } as HandlerContext, { owner: "atomisthq", repo: "pochta", version });
            const updatedSpec = await (await p.findFile(inProject)).getContent();
            const updatedSpecOjb = JSON.parse(updatedSpec);
            assert(updatedSpecOjb.spec.template.spec.containers[0].image === "sforzando-dockerv2-local.jfrog.io/pochta:1.2.3-123123123");
            done();
        });
    });

    it("doesn't update if there is no matching repo", done => {
        const pochtaSpec = "80-pochta-deployment.json";
        const inProject = `us-east-1c/${pochtaSpec}`;
        fs.readFile(`test/${pochtaSpec}`, async (_, c) => {
            const contents = c.toString();
            const version = "1.2.3-123123123";
            const p = InMemoryProject.from(new SimpleRepoId("atomist", "sdm"),
                { path: inProject, content: contents });
            await updateK8Spec(p, {} as HandlerContext, { owner: "atomista", repo: "bruce", version });
            const updatedSpec = await (await p.findFile(inProject)).getContent();
            assert(!updatedSpec.includes(version));
            done();
        });
    });

    it("should add .atomist/hooks for maven caching if not there", async () => {
        const p = InMemoryProject.from(new SimpleRepoId("atomist", "sdm"),
            { path: "project.clj", content: "{}" });
        (p as any).makeExecutable = (target: string) => Promise.resolve();
        const fixed = await addCacheHooks(p);
        assert(await fixed.findFile("project.clj"));

        assert(await fixed.findFile(".atomist/hooks/post-code-build"));
    });
});

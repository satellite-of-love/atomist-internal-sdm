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

import {
    HandlerContext, logger, Parameter, Parameters, SuccessPromise,
} from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";
import * as clj from "@atomist/clj-editors";
import {
    allSatisfied,
    Builder,
    EditorRegistration,
    ExecuteGoalResult,
    ExtensionPack,
    hasFile,
    ProjectLoader,
    RunWithLogContext,
    SoftwareDeliveryMachineOptions,
    StatusForExecuteGoal,
} from "@atomist/sdm";
import {
    DockerBuildGoal,
    DockerOptions,
    executeDockerBuild,
    executeVersioner,
    readSdmVersion,
    VersionGoal,
} from "@atomist/sdm-core";
import { ProjectVersioner } from "@atomist/sdm-core/internal/delivery/build/local/projectVersioner";
import { SpawnBuilder } from "@atomist/sdm-core/internal/delivery/build/local/SpawnBuilder";
import { IsLein } from "@atomist/sdm-core/pack/clojure/pushTests";
import { DockerImageNameCreator } from "@atomist/sdm-core/pack/docker/executeDockerBuild";
import * as build from "@atomist/sdm/api-helper/dsl/buildDsl";
import { branchFromCommit } from "@atomist/sdm/api-helper/goal/executeBuild";
import {
    asSpawnCommand,
    spawnAndWatch,
} from "@atomist/sdm/api-helper/misc/spawned";
import { SpawnOptions } from "child_process";
import * as df from "dateformat";
import * as fs from "fs";
import * as _ from "lodash";
import * as dir from "node-dir";
import * as path from "path";

import { EditorOrReviewerParameters } from "@atomist/automation-client/operations/common/params/BaseEditorOrReviewerParameters";
import { SimpleProjectEditor } from "@atomist/automation-client/operations/edit/projectEditor";
import { Project } from "@atomist/automation-client/project/Project";
import { doWithFiles } from "@atomist/automation-client/project/util/projectUtils";
import { ExecuteGoalWithLog } from "@atomist/sdm";
import { CloningProjectLoader } from "@atomist/sdm/api-helper/project/cloningProjectLoader";
import { IntegrationTestGoal, PublishGoal, UpdateProdK8SpecsGoal, UpdateStagingK8SpecsGoal } from "./goals";
import { rwlcVersion } from "./release";

import { executeSmokeTests } from "@atomist/atomist-sdm/machine/smokeTest";

const imageNamer: DockerImageNameCreator =
    async (p: GitProject, status: StatusForExecuteGoal.Fragment, options: DockerOptions, ctx: HandlerContext) => {

        const projectclj = path.join(p.baseDir, "project.clj");
        const commit = status.commit;
        const newversion = await readSdmVersion(
            commit.repo.owner, commit.repo.name, commit.repo.org.provider.providerId, commit.sha,
            branchFromCommit(commit),
            ctx);
        const projectName = _.last(clj.getName(projectclj).split("/"));
        logger.info(`Docker Image name is generated from ${projectclj} name and version ${projectName} ${newversion}`);
        return {
            name: projectName,
            registry: options.registry,
            version: newversion,
        };
    };

export const LeinSupport: ExtensionPack = {
    name: "Leiningen Support",
    vendor: "Atomist",
    version: "0.1.0",
    configure: sdm => {

        sdm.addBuildRules(
            build.when(IsLein)
                .itMeans("Lein build")
                .set(leinBuilder(sdm.configuration.sdm.projectLoader)),
        );

        sdm.addGoalImplementation("Deploy Jar", PublishGoal,
            leinDeployer(sdm.configuration.sdm));

        sdm.addGoalImplementation("leinVersioner", VersionGoal,
            executeVersioner(sdm.configuration.sdm.projectLoader, LeinProjectVersioner), { pushTest: IsLein });

        sdm.addGoalImplementation("updateStagingK8Specs", UpdateStagingK8SpecsGoal,
            k8SpecUpdater(sdm.configuration.sdm, "staging"));

        sdm.addGoalImplementation("updateProdK8Specs", UpdateProdK8SpecsGoal,
            k8SpecUpdater(sdm.configuration.sdm, "prod"));

        sdm.addGoalImplementation("integrationTests", IntegrationTestGoal,
            executeSmokeTests(sdm.configuration.sdm.projectLoader, {
                team: "T1L0VDKJP",
                org: "atomisthqa",
                port: 2867,
                sdm: new GitHubRepoRef("atomist", "sample-sdm"),
                graphql: "https://automation-staging.atomist.services/graphql/team",
                api: "https://automation-staging.atomist.services/registration",
            }, new GitHubRepoRef("atomist", "sdm-smoke-test"), "nodeBuild"),
        );

        sdm.addGoalImplementation("leinDockerBuild", DockerBuildGoal,
            executeDockerBuild(
                sdm.configuration.sdm.projectLoader,
                imageNamer,
                [MetajarPreparation],
                {
                    ...sdm.configuration.sdm.docker.jfrog as DockerOptions,
                    dockerfileFinder: async () => "docker/Dockerfile",
                }), { pushTest: allSatisfied(IsLein, hasFile("docker/Dockerfile")) });

        sdm.addAutofix(

            {
                name: "cljformat",
                editor: async p => {
                    await clj.cljfmt(p.baseDir);
                    return p;
                },
                pushTest: IsLein,
            });

        sdm.addAutofix(
            {
                name: "maven-repo-cache",
                editor: addCacheHooks,
                pushTest: IsLein,
            },
        );

        sdm.addEditor(UpdateK8SpecEditor);
    },
};

async function addCacheHooks(p: Project): Promise<Project> {
    const dotAtomist = path.join(fs.realpathSync(__dirname), "../../../resources/dot-atomist");
    await dir.files(dotAtomist, async (err, files) => {
        files.forEach(file => {
            // tslint:disable-next-line:no-shadowed-variable
            fs.readFile(file, async (err, c) => {
                await p.addFile(path.join(".atomist/", file), c.toString());
            });

        });
    });
    return p;
}

@Parameters()
export class K8SpecUpdaterParameters {

    @Parameter({ required: true, pattern: /prod|staging/, validInput: "prod | staging" })
    public readonly env: string;

    @Parameter({ required: true, pattern: /.*/ })
    public readonly version: string;
}

/**
 * A command handler wrapping the editor
 * @type {HandleCommand<EditOneOrAllParameters>}
 */
export const UpdateK8SpecEditor: EditorRegistration = {

    createEditor: () => async (project: Project, ctx: HandlerContext, params: any): Promise<Project> => {

        const version = params.version;
        const owner = project.id.owner;
        const repo = project.id.repo;
        const credentials = (params as EditorOrReviewerParameters).targets.credentials;

        return CloningProjectLoader.doWithProject({
            credentials,
            id: new GitHubRepoRef("atomisthq", "atomist-k8-specs", params.env),
            readOnly: false,
            context: ctx,
        },
            async (prj: GitProject) => {
                const result = await updateK8Spec(prj, ctx, { owner, repo, version });
                await prj.commit(`Update ${owner}/${repo} to ${version}`);
                await prj.push();
                return result;
            },
        );
    },
    name: "k8-spec-updater",
    paramsMaker: () => new K8SpecUpdaterParameters(),
    intent: "update spec",
};

/**
 * Update all Deployments that contain the mapping
 * @param owner
 * @param repo
 * @param version
 * @param project
 */
export const updateK8Spec: SimpleProjectEditor = async (project: Project, ctx: HandlerContext, params: any): Promise<Project> => {

    const owner = params.owner;
    const repo = params.repo;
    const version = params.version;

    return doWithFiles(project, "**/*.json", async f => {
        logger.info("Processing file: " + f.path);
        const spec = JSON.parse(await f.getContent());
        let dirty = false;
        if (spec.kind === "Deployment") {
            const template = spec.spec.template;
            const updater = template.metadata.annotations["atomist.updater"] as string;
            if (updater) {
                logger.info("Found updater config" + updater);
                const mapping = updater.replace("{", "").replace("}", "").split(" ");
                if (`${owner}/${repo}` === mapping[1]) {
                    spec.spec.template.spec.containers = _.reduce(
                        spec.spec.template.spec.containers, (acc, container) => {
                            const repoWithName = container.image.split(":")[0];
                            if (repoWithName === mapping[0]) {
                                const nv = container.image.split("/")[1].split(":");
                                if (nv[1] !== version) {
                                    dirty = true;
                                    container.image = `${repoWithName}:${version}`;
                                }
                            }
                            acc.push(container);
                            return acc;
                        }, []);
                }
                if (dirty) {
                    logger.info("Spec updated, writing to " + f.path);
                    await f.setContent(JSON.stringify(spec, null, 2));
                    logger.info("Spec written " + f.path);
                }
            }
        }
        if (dirty) {
            logger.info(`Updated ${owner}/${repo} to ${version} in ${f.path}`);
        }
    });

};

function leinDeployer(sdm: SoftwareDeliveryMachineOptions): ExecuteGoalWithLog {
    return async (rwlc: RunWithLogContext): Promise<ExecuteGoalResult> => {
        const { credentials, id, context } = rwlc;
        const version = await rwlcVersion(rwlc);

        return sdm.projectLoader.doWithProject({
            credentials,
            id,
            readOnly: false,
            context,
        },
            async (project: GitProject) => {
                const file = path.join(project.baseDir, "project.clj");
                await clj.setVersion(file, version);
                return spawnAndWatch({
                    command: "lein",
                    args: [
                        "deploy",
                    ],
                }, await enrich({
                    cwd: project.baseDir,
                    env: process.env,
                }, project), rwlc.progressLog);
            },
        );
    };
}

function k8SpecUpdater(sdm: SoftwareDeliveryMachineOptions, branch: string): ExecuteGoalWithLog {
    return async (rwlc: RunWithLogContext): Promise<ExecuteGoalResult> => {
        const { credentials, id } = rwlc;
        const version = await rwlcVersion(rwlc);
        return sdm.projectLoader.doWithProject({
            credentials,
            id: new GitHubRepoRef("atomisthq", "atomist-k8-specs", branch),
            readOnly: false,
            context: rwlc.context,
        },
            async (project: GitProject) => {
                await updateK8Spec(project, rwlc.context, { owner: id.owner, repo: id.repo, version });
                await project.commit(`Update ${id.owner}/${id.repo} to ${version}`);
                await project.push();
                return SuccessPromise;
            },
        );
    };
}

/**
 * Add stuff from vault to env
 * @param options original options
 * @param project optional project
 */
async function enrich(options: SpawnOptions = {}, project: GitProject): Promise<SpawnOptions> {
    const key = process.env.TEAM_CRED;
    const vault = path.join(fs.realpathSync(__dirname), "../../../resources/vault.txt");
    const defaultEncryptedEnv = { env: clj.vault(key, vault) };
    logger.info(`run build enrichment on SpawnOptions`);
    const encryptedEnv = { env: clj.vault(key, `${project.baseDir}/vault.txt`) };
    if (!options.cwd) {
        options.cwd = project.baseDir;
    }
    if (!options.env) {
        options.env = process.env;
    }
    const enriched = _.merge(options, defaultEncryptedEnv, encryptedEnv) as SpawnOptions;
    return enriched;
}

function leinBuilder(projectLoader: ProjectLoader): Builder {
    return new SpawnBuilder(
        {
            projectLoader,
            options: {
                name: "atomist.sh",
                commands: [asSpawnCommand("./atomist.sh", { env: {} })],
                errorFinder: (code, signal, l) => {
                    return code !== 0;
                },
                logInterpreter: log => {
                    return {
                        // We don't yet know how to interpret clojure logs
                        relevantPart: undefined,
                        message: "lein errors",
                    };
                },
                enrich,
                projectToAppInfo: async (p: GitProject) => {
                    const projectClj = await p.findFile("project.clj");
                    logger.info(`run projectToAppInfo in ${p.baseDir}/${projectClj.path}`);
                    return {
                        name: clj.getName(`${p.baseDir}/${projectClj.path}`),
                        version: clj.getVersion(`${p.baseDir}/${projectClj.path}`),
                        id: new GitHubRepoRef("owner", "repo"),
                    };
                },
            },
        });
}

export async function MetajarPreparation(p: GitProject, rwlc: RunWithLogContext): Promise<ExecuteGoalResult> {
    logger.info(`run ./metajar.sh from ${p.baseDir}`);
    const result = await spawnAndWatch(
        {
            command: "./metajar.sh",
            // args: ["with-profile", "metajar", "do", "clean,", "metajar"],
        },
        await enrich({}, p),
        rwlc.progressLog,
        {
            errorFinder: code => code !== 0,
        });
    return result;
}

export const LeinProjectVersioner: ProjectVersioner = async (status, p) => {
    const file = path.join(p.baseDir, "project.clj");
    let projectVersion = clj.getVersion(file);
    if (projectVersion.endsWith("-SNAPSHOT")) {
        projectVersion = projectVersion.replace("-SNAPSHOT", "");
    }
    const branch = branchFromCommit(status.commit);
    const branchSuffix = branch !== status.commit.repo.defaultBranch ? `${branch}.` : "";
    const version = `${projectVersion}-${branchSuffix}${df(new Date(), "yyyymmddHHMMss")}`;

    await clj.setVersion(file, version);

    return version;
};

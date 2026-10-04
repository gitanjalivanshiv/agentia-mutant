# Agentia MCP tools (`agentia mcp start`, CLI 1.0.0-beta.2)

Captured via a stdio `initialize` + `tools/list` handshake. 192 tools. Plugins cannot add tools here yet.

| Tool | Description |
|---|---|
| `agentia_ai_ask` | Send a single-turn prompt to a Copado AI agent and return the buffered response. |
| `agentia_data_template_list` | List Copado data templates via the CICD gateway. |
| `agentia_data_template_get` | Get a data template export graph (selected columns only). |
| `agentia_data_template_get_detail` | Get the raw v2 data template detail payload. |
| `agentia_data_template_create` | Create a Copado data template. |
| `agentia_data_template_save_detail` | Save a v2 data template detail payload. |
| `agentia_data_template_delete` | Delete a Copado data template. |
| `agentia_data_template_convert_old` | Convert a legacy data template graph to v2. |
| `agentia_data_records_search` | Search data records for a data template. |
| `agentia_data_records_match` | Match a source data record to a destination org. |
| `agentia_data_commit_create` | Create a data commit for a user story. |
| `agentia_data_commit_list` | List data commits for a user story. |
| `agentia_data_dataset_file_list` | List dataset files for a user story data commit. |
| `agentia_data_dataset_file_content` | Get dataset file content by ContentVersion Id. |
| `agentia_data_filter_list` | List advanced filters for a data template. |
| `agentia_data_filter_add` | Add an advanced filter to a data template. |
| `agentia_data_filter_update` | Update an advanced filter on a data template. |
| `agentia_data_filter_delete` | Delete an advanced filter from a data template. |
| `agentia_data_formula_list` | List record matching formulas for an sObject. |
| `agentia_data_formula_create` | Create a record matching formula for a data template. |
| `agentia_data_formula_update` | Update a record matching formula. |
| `agentia_data_sobject_fields` | Describe fields for an sObject via a credential. |
| `agentia_data_sobject_relationships` | Describe relationships for an sObject via a credential. |
| `agentia_data_sync_apply` | Apply data template field sync entries. |
| `agentia_data_sync_preview_updates` | Preview data template updates from metadata commit changes. |
| `agentia_work_deployment_step_types` | List standard and custom metadata-backed deployment-step types. |
| `agentia_work_deployment_step_salesforce_flows` | List directly invocable Salesforce Flows in the Copado org for deployment-step configuration. |
| `agentia_work_deployment_step_list` | List persisted deployment steps for an explicit or active user story. |
| `agentia_work_deployment_step_create` | Create a standard or custom metadata-backed deployment step on a user story. |
| `agentia_work_deployment_step_update` | Partially update a persisted deployment step. Null clears queueName or skipCondition. |
| `agentia_work_deployment_step_reorder` | Replace the complete before/after deployment-step order for a user story. |
| `agentia_work_deployment_step_delete` | Delete a persisted deployment step owned by a user story. |
| `agentia_health_check` | Run organization-scoped governance health checks via the CICD gateway. |
| `agentia_testing_project_list` | List Copado Robotic Testing projects. |
| `agentia_testing_project_create` | Create a Copado Robotic Testing project. |
| `agentia_testing_project_get` | Get a Copado Robotic Testing project from the project list. |
| `agentia_testing_project_update` | Update a Copado Robotic Testing project. |
| `agentia_testing_project_permission_list` | List assignments for a Copado Robotic Testing project. |
| `agentia_testing_project_permission_get` | Get the caller's permission on a Copado Robotic Testing project. |
| `agentia_testing_project_permission_set` | Set a validated user or group permission on a Copado Robotic Testing project. |
| `agentia_testing_project_permission_update` | Update a validated user or group permission on a Copado Robotic Testing project. |
| `agentia_testing_project_delete` | Delete a Copado Robotic Testing project. |
| `agentia_testing_robot_list` | List Copado Robotic Testing robots. |
| `agentia_testing_robot_get` | Get a Copado Robotic Testing robot from the project robot list. |
| `agentia_testing_robot_delete` | Delete a Copado Robotic Testing robot. |
| `agentia_testing_robot_create` | Create a Copado Robotic Testing robot. |
| `agentia_testing_robot_update` | Update a Copado Robotic Testing robot. |
| `agentia_testing_job_list` | List Copado Robotic Testing jobs/tests. |
| `agentia_testing_job_get` | Get a Copado Robotic Testing job/test from the project job list. |
| `agentia_testing_job_update` | Update Copado Robotic Testing job/test metadata or Git storage. |
| `agentia_testing_job_delete` | Delete a Copado Robotic Testing job/test. |
| `agentia_testing_job_schedule_get` | Get a Copado Robotic Testing job schedule. |
| `agentia_testing_job_schedule_set` | Create or update a Copado Robotic Testing job schedule. |
| `agentia_testing_job_schedule_remove` | Remove a Copado Robotic Testing job schedule. |
| `agentia_testing_data_table_list` | List Copado Robotic Testing data tables. |
| `agentia_testing_data_table_get` | Get a Copado Robotic Testing data table. |
| `agentia_testing_data_table_create` | Create a Copado Robotic Testing data table from structured string cells. |
| `agentia_testing_data_table_update` | Update a Copado Robotic Testing data table. |
| `agentia_testing_data_table_delete` | Delete a Copado Robotic Testing data table. |
| `agentia_testing_job_create` | Create a Copado Robotic Testing job/test from uploaded files or Git storage. |
| `agentia_testing_job_run` | Run a Copado Robotic Testing job/test. |
| `agentia_testing_job_files` | List files for a Copado Robotic Testing job/test. |
| `agentia_testing_job_refs` | List Git branches and tags for a Copado Robotic Testing job/test. |
| `agentia_testing_job_upload` | Upload file operations to a Copado Robotic Testing job/test. |
| `agentia_testing_job_download` | Download files from a Copado Robotic Testing job/test. |
| `agentia_testing_build_run` | Run a Copado Robotic Testing job/test. |
| `agentia_testing_build_list` | List Copado Robotic Testing builds/runs. |
| `agentia_testing_build_get` | Get a Copado Robotic Testing build/run. |
| `agentia_testing_build_latest` | List the latest Copado Robotic Testing builds/runs. |
| `agentia_testing_build_search` | Search Copado Robotic Testing build metrics. |
| `agentia_testing_build_logs` | Get logs for a Copado Robotic Testing build/run. |
| `agentia_testing_build_abort` | Abort a Copado Robotic Testing build/run. |
| `agentia_testing_variable_list` | List Copado Robotic Testing variables/secrets. |
| `agentia_testing_variable_get` | Get a Copado Robotic Testing variable/secret with value redaction. |
| `agentia_testing_variable_create` | Create a Copado Robotic Testing variable/secret. |
| `agentia_testing_variable_update` | Update a Copado Robotic Testing variable/secret. |
| `agentia_testing_variable_delete` | Delete a Copado Robotic Testing variable/secret. |
| `agentia_testing_user_parameter_list` | List account-scoped Copado Robotic Testing user parameters. |
| `agentia_testing_user_parameter_get` | Get an account-scoped Copado Robotic Testing user parameter with value redaction. |
| `agentia_testing_user_parameter_create` | Create an account-scoped Copado Robotic Testing user parameter. |
| `agentia_testing_user_parameter_update` | Update an account-scoped Copado Robotic Testing user parameter. |
| `agentia_testing_user_parameter_delete` | Delete an account-scoped Copado Robotic Testing user parameter. |
| `agentia_testing_create` | Create a Copado Robotic Testing test from uploaded files or Git storage. |
| `agentia_testing_update` | Update a Copado Robotic Testing test by uploading file operations. |
| `agentia_testing_run` | Run a Copado Robotic Testing test. |
| `agentia_testing_status` | List Copado Robotic Testing run status. |
| `agentia_testing_logs` | Get logs for a Copado Robotic Testing run. |
| `agentia_testing_live_start` | Start and bootstrap a bounded CRT live-testing session. |
| `agentia_testing_live_stop` | Stop the active CRT live-testing session. Requires explicit confirmation. |
| `agentia_testing_live_status` | Read sanitized status for the active CRT live-testing session. |
| `agentia_testing_live_execute` | Execute bounded Robot Framework keywords in the active CRT live-testing session. |
| `agentia_testing_live_continue` | Continue execution in the active CRT live-testing session. |
| `agentia_testing_live_interrupt` | Interrupt execution in the active CRT live-testing session. |
| `agentia_testing_live_inspect` | Read bounded sanitized page state without local file access. |
| `agentia_testing_live_screenshot` | Save a bounded CRT live screenshot to an isolated temporary path. |
| `agentia_testing_live_reports` | List bounded live report metadata without local file access. |
| `agentia_testing_live_set_options` | Set the complete validated CRT live recorder option block. |
| `agentia_testing_live_history` | Read bounded sanitized local CRT live execution history. |
| `agentia_environment_list` | List Copado environments via the CICD gateway. |
| `agentia_environment_get` | Get a Copado environment by Id via the CICD gateway. |
| `agentia_environment_create` | Create a Copado environment via the CICD gateway. |
| `agentia_environment_update` | Update a Copado environment by Id via the CICD gateway. |
| `agentia_credential_create` | Create a Copado environment credential via the CICD gateway. |
| `agentia_credential_list` | List credentials for a Copado environment via the CICD gateway. |
| `agentia_credential_update` | Update a Copado environment credential by Id via the CICD gateway. |
| `agentia_promotion_list` | List Copado promotions via the CICD gateway. |
| `agentia_promotion_get` | Get a Copado promotion by Id via the CICD gateway. |
| `agentia_promotion_run` | Preflight, start, and optionally wait for a Copado promotion. Can also resume an existing execution without st |
| `agentia_promotion_job_step_update` | Update a manual task for a Copado promotion job step via the CICD gateway. |
| `agentia_job_list` | List Copado job executions via the CICD gateway. |
| `agentia_job_get` | Get a Copado job execution with ordered steps via the CICD gateway. |
| `agentia_job_run` | Run all steps for a Copado job execution via the CICD gateway. |
| `agentia_job_resume` | Resume outstanding steps for a Copado job execution via the CICD gateway. |
| `agentia_job_kill` | Cancel a Copado job execution via the CICD gateway. |
| `agentia_job_pause` | Pause a Copado job execution via the CICD gateway (resumable cancel alias). |
| `agentia_pipeline_list` | List Copado pipelines via the CICD gateway. |
| `agentia_pipeline_get` | Describe a Copado pipeline via the CICD gateway. |
| `agentia_pipeline_create` | Create a Copado pipeline via the CICD gateway. |
| `agentia_pipeline_update` | Update a Copado pipeline via the CICD gateway. |
| `agentia_pipeline_connection_list` | List Copado pipeline connections via describe or pipeline list. |
| `agentia_pipeline_connection_create` | Create one or more Copado pipeline connections via the CICD gateway. |
| `agentia_pipeline_connection_update` | Update one or more Copado pipeline connections via the CICD gateway. |
| `agentia_pipeline_connection_delete` | Delete one or more Copado pipeline connections via the CICD gateway. |
| `agentia_stage_list` | List Copado stages via the CICD gateway. |
| `agentia_stage_get` | Get a Copado stage via the CICD gateway. |
| `agentia_stage_create` | Create a Copado stage. Common metaStage values include Build, Test, Production; custom values are allowed. |
| `agentia_stage_update` | Update a Copado stage via the CICD gateway. |
| `agentia_stage_delete` | Delete a Copado stage via the CICD gateway. |
| `agentia_pipeline_stage_connection_create` | Create a pipeline stage connection via the CICD gateway. |
| `agentia_pipeline_stage_connection_list` | List pipeline stage connections from the pipeline describe response. |
| `agentia_pipeline_stage_connection_update` | Update a pipeline stage connection via the CICD gateway. |
| `agentia_pipeline_stage_connection_delete` | Delete a pipeline stage connection via the CICD gateway. |
| `agentia_project_list` | List Copado projects via the CICD gateway. |
| `agentia_user_get` | Get a Copado user by Id via the CICD gateway. Defaults to the authenticated user ("me"). |
| `agentia_navigation_resolve` | Resolve a browser navigation URL for a Copado resource. |
| `agentia_project_default_get` | Show Agentia project default values for the current project or globally. |
| `agentia_project_default_set` | Set Agentia project default values for the current project or globally. |
| `agentia_project_default_unset` | Remove Agentia project default values from the current project or globally. |
| `agentia_work_list` | List Copado user stories via the CICD gateway. |
| `agentia_work_get` | Get a Copado user story by Id via the CICD gateway. Omit Id to use the active work item from work set. |
| `agentia_work_create` | Create a Copado user story via the CICD gateway. |
| `agentia_work_update` | Update a Copado user story by Id via the CICD gateway. Omit Id to use the active work item from work set. |
| `agentia_work_delete` | Delete a Copado user story by Id via the CICD gateway. |
| `agentia_work_set` | Set the active Copado work item and prepare a local feature/<user-story-name> branch. Requires a clean tracked |
| `agentia_work_publish` | Publish the current feature/<lastWorkItem> branch and register commits with Copado. Requires a clean working t |
| `agentia_work_push` | Compatibility alias of agentia_work_publish. Prefer agentia_work_publish. Publishes the current feature/<lastW |
| `agentia_cloud_commit` | Create a Copado cloud metadata commit. Preflights the user story, submits POST /release/commit, and optionally |
| `agentia_work_commit` | Compatibility alias of agentia_cloud_commit. Prefer agentia_cloud_commit. Create a Copado cloud metadata commi |
| `agentia_cloud_promote` | Resolve a Promotion from an explicit or active User Story, then preflight, start, and optionally wait for the  |
| `agentia_work_submit` | Submit the current feature/US-XXXX work item for pipeline quality gates and validation. Runs project-root .age |
| `agentia_work_test` | Run quality gates for the current work item. With local=true (the default when cloud is omitted), runs project |
| `agentia_work_test_apex` | Run specified Apex test classes via Salesforce CLI (`sf apex run test`) with code coverage. Usually run from p |
| `agentia_work_done` | Compatibility alias of agentia_work_submit with done=true (Copado UI Submit promote). Prefer agentia_work_subm |
| `agentia_metadata_list` | Search the Copado metadata index via the CICD gateway. |
| `agentia_metadata_content_get` | Retrieve metadata file content via the CICD gateway. |
| `agentia_metadata_index_compare` | Compare metadata between orgs or Git branches via the CICD gateway. |
| `agentia_metadata_content_compare` | Compare one metadata component between two orgs or Git branches and return a unified diff. |
| `agentia_metadata_dependency_list` | Retrieve metadata dependencies via the CICD gateway. |
| `agentia_auth_get` | Show masked Agentia credential status from the system keychain. |
| `agentia_auth_set` | Store CICD, AI, and/or CRT credentials in the system keychain. Credential input is sensitive. |
| `agentia_environment_auth_status` | Validate an environment credential through the CICD gateway. |
| `agentia_job_log_get` | Get raw log output for a Copado job execution step. |
| `agentia_job_result_file_list` | List Files linked to a Copado job Result. |
| `agentia_job_result_file_get` | Get a File linked to a Copado job Result. |
| `agentia_project_get` | Get a Copado project by ID via the CICD gateway. |
| `agentia_project_create` | Create a Copado project via the CICD gateway. |
| `agentia_project_update` | Update a Copado project by ID via the CICD gateway. |
| `agentia_project_delete` | Delete a Copado project by ID via the CICD gateway. Requires confirm: true. |
| `agentia_repository_list` | List Copado Git repositories via the CICD gateway. |
| `agentia_repository_get` | Get a Copado Git repository by ID via the CICD gateway. |
| `agentia_repository_create` | Create a Copado Git repository via the CICD gateway. |
| `agentia_repository_update` | Update a Copado Git repository by ID via the CICD gateway. Nullable fields can be set to null. |
| `agentia_repository_delete` | Delete a Copado Git repository by ID via the CICD gateway. |
| `agentia_repository_reset` | Reset a Copado Git repository by ID via the CICD gateway. |
| `agentia_repository_validate` | Validate Copado Git repository authentication via the CICD gateway. |
| `agentia_function_list` | List Copado Functions via the CICD gateway. |
| `agentia_function_get` | Get a Copado Function by API name via the CICD gateway. |
| `agentia_function_defaults` | Scaffold default Copado Function metadata without writing to Salesforce. |
| `agentia_function_upsert` | Create or update a Copado Function by API name via the CICD gateway. |
| `agentia_function_delete` | Delete a Copado Function by API name via the CICD gateway. |
| `agentia_function_run` | Run a Copado Function and return the result Id. |
| `agentia_function_run_local` | Run a Copado Function script locally in Docker without calling the CICD gateway. Override image when the Copad |
| `agentia_function_result_get` | Get Copado Function execution status by result Id. |
| `agentia_function_result_log_get` | Get log output for a Copado Function result. |
| `agentia_promotion_conflict_list` | List merge conflicts for a Copado promotion. |
| `agentia_promotion_conflict_get` | Get raw merge-conflict content for a Copado promotion file. |
| `agentia_promotion_conflict_resolve` | Resolve a promotion merge conflict automatically or with manual content. |
| `agentia_promotion_conflict_unresolve` | Undo a promotion conflict resolution. |
| `agentia_metadata_refresh_run` | Trigger a metadata index refresh via the CICD gateway. |
| `agentia_metadata_refresh_status` | Get metadata index refresh status via the CICD gateway. |
| `agentia_metadata_refresh_deleted` | Refresh deleted metadata index entries via the CICD gateway. |
| `agentia_work_status` | Get work status and related jobs. Includes local branch metadata when lastBaseBranch is recorded. Use metadata |

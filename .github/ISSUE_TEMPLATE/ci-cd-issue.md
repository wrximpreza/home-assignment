---
name: CI/CD Issue
about: Report issues with the CI/CD pipeline, deployments, or automation
title: '[CI/CD] '
labels: ['ci/cd', 'bug']
assignees: ''
---

## Issue Description

**Brief description of the CI/CD issue:**
<!-- Describe what went wrong with the pipeline, deployment, or automation -->

## Environment

**Affected Environment(s):**
- [ ] Development
- [ ] Staging
- [ ] Production
- [ ] All environments

**Workflow/Job:**
- [ ] CI Pipeline (ci.yml)
- [ ] Deploy Pipeline (deploy.yml)
- [ ] Security and Maintenance (security-and-maintenance.yml)
- [ ] Other: ___________

## Failure Details

**Failed Job/Step:**
<!-- Name of the specific job or step that failed -->

**Error Message:**
```
<!-- Paste the error message or relevant log output here -->
```

**Workflow Run URL:**
<!-- Link to the failed GitHub Actions workflow run -->

## Expected Behavior

**What should have happened:**
<!-- Describe the expected successful outcome -->

## Actual Behavior

**What actually happened:**
<!-- Describe what went wrong -->

## Reproduction Steps

1. <!-- Step 1 -->
2. <!-- Step 2 -->
3. <!-- Step 3 -->

## Additional Context

**Recent Changes:**
<!-- Any recent code changes, configuration updates, or environment modifications -->

**Related Issues:**
<!-- Link to any related issues or pull requests -->

**Screenshots/Logs:**
<!-- Add any additional screenshots or log files that might help -->

## Checklist

- [ ] I have checked the [CI/CD documentation](../docs/CI_CD.md)
- [ ] I have verified the GitHub secrets are correctly configured
- [ ] I have checked the AWS console for any infrastructure issues
- [ ] I have reviewed recent commits for potential causes
- [ ] This issue is reproducible

## Priority

- [ ] Critical (Production deployment blocked)
- [ ] High (Staging deployment blocked)
- [ ] Medium (Development deployment affected)
- [ ] Low (Minor automation issue)

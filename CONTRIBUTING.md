# Contributing

Thanks for contributing to Shadow API.

## Development Principles

- Keep extraction logic deterministic and testable
- Favor explicit schemas over ad-hoc JSON outputs
- Optimize for low-latency hot paths
- Document breaking changes in `CHANGELOG.md`

## Contribution Workflow

1. Fork the repository and create a feature branch
2. Keep pull requests focused and small
3. Add or update tests where behavior changes
4. Update docs when adding endpoints or settings
5. Open a PR with a clear summary and validation notes

## Pull Request Checklist

- [ ] Code compiles and tests pass locally
- [ ] Documentation updated
- [ ] Security/privacy implications considered
- [ ] Performance impact noted for hot paths

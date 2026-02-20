# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

### Fixed
- setTimeout side effect during render phase in ExternalPreviewPanel (#2)
- Inline closures break BlogCard memo() in feed maps (#1)

### Changed
- Replace effect-based state sync with event handler for search clearing (#6)
- Extract renderPostContent into a proper React component (#4)
- Hoist pure functions to module scope in ExternalPreviewPanel (#3)
- Stabilize onExternalPostSelect callback passed to FeedSection (#5)

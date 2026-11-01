# Change Log

All notable changes to the "sqlc-plus" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Add the command `sqlc-plus.convert` that copies the selected query, or the whole document, to the clipboard as an executable query.
- Convert `sqlc.embed`, `sqlc.arg`, `sqlc.narg`, `sqlc.slice` and the `@name` shorthand.
- Remove the query annotations of sqlc, and keep the other comments.
- Number the parameters per statement, and give a name that occurs twice one number, as `sqlc` does.
- Add the setting `sqlc-plus.placeholderStyle` for the `postgres`, `mysql` and `sqlite` placeholder syntax.
- Add the command to the Command Palette and to the editor right-click menu.
- Add the command `sqlc-plus.convertWithValues` that writes the values of the parameters in a CTE, so the query runs as it is.
- Add the setting `sqlc-plus.parameterValues` that holds the value of each parameter, by parameter name.

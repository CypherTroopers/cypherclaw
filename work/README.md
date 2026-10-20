# Cypherノード管理プラグイン

開発プロジェクトは [`cypher-node-plugin`](./cypher-node-plugin/) です。既存のCypherClawとは別に構築しています。

- 6タブと独自ロゴ、ノード・ウォレット・送金・マイニング・Explorerの操作を維持。
- 「ノードを準備」を押したときだけ、GatewayのOS/CPUに対応する固定バージョンをCypherリポジトリから取得。
- サイズとSHA-256の一致を確認し、必要なWindows DLLも同じ手順で取得。
- 配布パッケージにノード本体・DLL・ウォレット生成ツールは含めません。

インストール手順と対応OSはプロジェクトの [README](./cypher-node-plugin/README.md)、確認結果と未検証範囲は [VALIDATION](./cypher-node-plugin/VALIDATION.md) を参照してください。ClawHubにはまだ公開していません。

ローカルパッケージは `cypher-node-plugin/artifacts/cyphertroopers-openclaw-cypher-0.1.0.tgz` にあります。公式OpenClaw 2026.10.5用です。CypherClaw内蔵の同名機能と同時には読み込まないでください。

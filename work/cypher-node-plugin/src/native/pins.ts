import type { NativeArtifact, NativePin, NativeTarget } from "./types.js";

export const NODE_PIN: NativePin = {
  repository: "CypherTroopers/cypher",
  distributionCommit: "9ca4b9793d6e3527f4439ab4cc29a500a160c134",
  sourceCommit: "546d43442e8156591786dc3c1ca1596f014509e3",
};

// The retained release metadata identifies the historical source. The available
// distribution has identical executable bytes but rewrote its build-info files.
export const WALLET_PIN: NativePin = {
  repository: "CypherTroopers/offlinewalletgenerator",
  distributionCommit: "629b3122aab207a7d7149439101c571a3360eecf",
  sourceCommit: "8879d9e4c0490999096bb299a0e2da31a1b20e50",
};

const file = (path: string, bytes: number, sha256: string, executable = false): NativeArtifact => ({
  path,
  bytes,
  sha256,
  executable,
});

function provenance(target: string, records: ReadonlyArray<readonly [string, number, string]>) {
  return records.map(([name, bytes, sha256]) =>
    file(`build/provenance/${target}/${name}`, bytes, sha256),
  );
}

export const NODE_ARTIFACTS: Partial<Record<NativeTarget, readonly NativeArtifact[]>> = {
  "linux-amd64": [
    file(
      "build/bin/cypher-linux-amd64",
      52854872,
      "c15191998ea1149bcc8ef69aec0e48d5665c6b65320d2794b14fd40068b8abb5",
      true,
    ),
    ...provenance("linux-amd64", [
      ["manifest.txt", 892, "3c9fec3517572227c0559063612f54bcab6a2b8612fbe4511ada080e66dcf8c7"],
      [
        "go-build-info.txt",
        7075,
        "f5b4a0b1a2c372ce8f3278b558ab00710bf0a8c053bb666e905851081dbd8c61",
      ],
      ["SHA256SUMS", 321, "f88fde0fa6cb97e1cbe377740f511bcb1ffca048e62bfd6c7c108915571190a4"],
    ]),
  ],
  "darwin-arm64": [
    file(
      "build/bin/cypher-darwin-arm64",
      50369410,
      "10ffc572039a884fc9b23d57d321e4ffc4c6845c814952a7e72b1e374d45b427",
      true,
    ),
    ...provenance("darwin-arm64", [
      ["manifest.txt", 920, "35e8c9260eb0b0cda113cd340de615de9d893aba89d5bccd3a4669750688fc7c"],
      [
        "go-build-info.txt",
        6875,
        "d54e4d82e3fa6cc93d9d82204e2aea2ab7c3b8b432d342624bb855a751509990",
      ],
      ["SHA256SUMS", 249, "9302876a7137aba16ad9cbfa3214c908c377960fa6683f9215ee009083a88da7"],
    ]),
  ],
  "windows-amd64": [
    file(
      "build/bin/cypher.exe",
      71261610,
      "0dcbf99a630367594de179f63ee0b1b447f550ba7b37a4a58eb4edcabd21808b",
      true,
    ),
    file(
      "build/bin/libcrypto-3-x64.dll",
      5495630,
      "ad397e1391ae38100fa1043d69a3495efa73fd9c2784de0ffc3ede3df1fd092e",
    ),
    file(
      "build/bin/libgcc_s_seh-1.dll",
      149364,
      "d7e343dd266747177c3699bc3201ea36eceef158e98530e089263bc55bb2a6d7",
    ),
    file(
      "build/bin/libgmp-10.dll",
      679747,
      "37248cda33845e7c5c35a574e57da762dd0a8268f0270d179f30a33746809681",
    ),
    file(
      "build/bin/libstdc++-6.dll",
      2659216,
      "494bd9045948198ef4d3bc838c7362d4cfd49c890b439c096b1817aa7c7fa6ff",
    ),
    file(
      "build/bin/libwinpthread-1.dll",
      66333,
      "72bf8802de3a99d28f0bc2db9a11f281a9f9f3fa83dab2bc67e69fac3bd3d9c0",
    ),
    ...provenance("windows-amd64", [
      ["manifest.txt", 1274, "cb51f5dbee775110e0693f21a72455886121c721bc451d8a428e742131cc65ca"],
      [
        "go-build-info.txt",
        7154,
        "1057084fec8e95dec0ee1dffc4803cfb3d4d631aa6f25a7cdd6e8e11149aa92f",
      ],
      ["SHA256SUMS", 659, "5334692b4c423356cbd63de7161ecdbadc4e39c3de6ec630221766ce6759d852"],
    ]),
  ],
};

export const WALLET_ARTIFACTS: Record<NativeTarget, readonly NativeArtifact[]> = {
  "linux-amd64": [
    file(
      "bin/linux-amd64/coldwalletgenerator",
      5375467,
      "a4c7183c2400f713563eea275e744fd90e840f5def3fd9f5790bea9bfbdbdd76",
      true,
    ),
  ],
  "linux-arm64": [
    file(
      "bin/linux-arm64/coldwalletgenerator",
      5080948,
      "c1e2c8d4a43eb479173d975d10b18f979c85a227cd3ceb9581a8666405670d41",
      true,
    ),
  ],
  "darwin-amd64": [
    file(
      "bin/darwin-amd64/coldwalletgenerator",
      5458832,
      "c9f1abc05bd5988486350777c403d1404b5bccd6990369c4c97cbf4e5f5ebb92",
      true,
    ),
  ],
  "darwin-arm64": [
    file(
      "bin/darwin-arm64/coldwalletgenerator",
      5174898,
      "ab12b2aa31e4d07a5e9a130a24f1df0c4a275518d74d29f9bb35a80b998411f0",
      true,
    ),
  ],
  "windows-amd64": [
    file(
      "bin/windows-amd64/coldwalletgenerator.exe",
      5442560,
      "3f5253dfd8d82a1c98b02a6e96a18b6abfbb61fcc34c92c427dd95d41c18a5c2",
      true,
    ),
  ],
  "windows-arm64": [
    file(
      "bin/windows-arm64/coldwalletgenerator.exe",
      5037056,
      "fc9423112440eb44221491988601f33d01dd1a24632197f3b4a6f5872b98fe05",
      true,
    ),
  ],
};

export function resolveNativeTarget(platform: string, arch: string): NativeTarget | null {
  const os = platform === "win32" ? "windows" : platform;
  const cpu = arch === "x64" ? "amd64" : arch;
  const target = `${os}-${cpu}`;
  switch (target) {
    case "linux-amd64":
    case "linux-arm64":
    case "darwin-amd64":
    case "darwin-arm64":
    case "windows-amd64":
    case "windows-arm64":
      return target;
    default:
      return null;
  }
}

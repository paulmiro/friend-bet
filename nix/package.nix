{ bun2nix, ... }:
bun2nix.writeBunApplication {
  # Could also be `pname` and `version`
  # See the `mkDerivation` docs if this
  # looks unfamiliar to you
  packageJson = ../package.json;

  src = ../.;

  # Use the `build` script from
  # `package.json` instead of
  # bun's bundler accessed via
  # `bun build`
  #
  # Confusing, isn't it?
  buildPhase = ''
    bun run build
  '';

  # Start script to use to launch
  # your project at runtime
  startScript = ''
    bun run start
  '';

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };
}

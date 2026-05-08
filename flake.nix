{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";

    bun2nix.url = "github:nix-community/bun2nix";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    { flake-parts, bun2nix, ... }@inputs:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      imports = [
        ./nix/module.nix
      ];
      perSystem =
        { pkgs, system, ... }:
        {
          devShells = {
            default = pkgs.mkShell {
              packages = with pkgs; [
                bun
                bun2nix.packages.${system}.default
                gemini-cli
              ];
            };
          };

          packages.default = pkgs.callPackage ./nix/package.nix {
            bun2nix = bun2nix.packages.${system}.default;
          };
        };

    };
}


let
  # https://nixos.wiki/wiki/Nix_channels
  # https://status.nixos.org/
  unstable = import (fetchTarball https://nixos.org/channels/nixos-unstable/nixexprs.tar.xz) { };
in
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  nativeBuildInputs = with pkgs.buildPackages; [
    # System dependencies
    ncurses
    openssh
    git
    bun
  ];
}

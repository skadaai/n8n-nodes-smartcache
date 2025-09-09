
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  nativeBuildInputs = with pkgs.buildPackages; [
    # System dependencies
    ncurses
    openssh
    git

    # Tools for Node environment management
    corepack_latest
    nodePackages_latest.nodejs
  ];
}

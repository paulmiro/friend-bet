{ self, ... }:
{
  flake.nixosModules.friend-bet =
    {
      config,
      lib,
      ...
    }:
    let
      cfg = config.services.friend-bet;
    in
    {
      options.services.friend-bet = {
        enable = lib.mkEnableOption "friend-bet";
        port = lib.mkOption {
          type = lib.types.port;
          default = 3000;
        };
        name = lib.mkOption {
          type = lib.types.str;
          default = "Friend";
        };
      };

      config = lib.mkIf cfg.enable {
        systemd.services.friend-bet = {
          description = "Friend-Bet Server";
          wantedBy = [ "multi-user.target" ];
          after = [ "network.target" ];
          environment = {
            FRIEND_BET_PORT = toString cfg.port;
            FRIEND_BET_NAME = cfg.name;
            FRIEND_BET_DB_LOCATION = "/var/lib/friend-bet";
          };
          serviceConfig = {
            Type = "exec";
            ExecStart = "${self.packages.${config.nixpkgs.hostPlatform.system}.default}/bin/friend-bet";
            StateDirectory = "friend-bet";
            Restart = "on-failure";
            RestartSec = 5;
            DynamicUser = true;

            ProtectSystem = "strict";
            ProtectHome = true;
            PrivateTmp = true;
            PrivateDevices = true;
            ProtectHostname = true;
            ProtectClock = true;
            ProtectKernelTunables = true;
            ProtectKernelModules = true;
            ProtectKernelLogs = true;
            ProtectControlGroups = true;
            NoNewPrivileges = true;
            RestrictRealtime = true;
            RestrictSUIDSGID = true;
            RemoveIPC = true;
            PrivateMounts = true;
          };
        };
      };

    };
}

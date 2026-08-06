-- Add 'whatsapp' to the comm_channel enum for Kirimdev WA integration
ALTER TYPE comm_channel ADD VALUE IF NOT EXISTS 'whatsapp';
